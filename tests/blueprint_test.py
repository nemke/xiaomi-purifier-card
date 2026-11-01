"""Execute the shipped blueprint's branches with HA-shaped state and Jinja templates."""
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import yaml
from jinja2.nativetypes import NativeEnvironment

FAN, TIMER, DEADLINE = 'fan.purifier', 'timer.shutdown', 'input_text.deadline'

class BlueprintSimulation:
    def __init__(self):
        self.clock = 1800000000
        self.entities = {FAN: {'state': 'on'}, TIMER: {'state': 'idle'}, DEADLINE: {'state': ''}}
        self.calls = []
        inputs = {'purifier': FAN, 'shutdown_timer': TIMER, 'deadline': DEADLINE}
        class Loader(yaml.SafeLoader): pass
        Loader.add_constructor('!input', lambda loader, node: inputs[loader.construct_scalar(node)])
        self.blueprint = yaml.load(Path('blueprints/breeze-shutdown.yaml').read_text(), Loader=Loader)
        self.env = NativeEnvironment()
        self.env.globals.update(states=lambda entity: self.entities.get(entity, {}).get('state', 'unknown'), is_state=lambda entity, value: self.entities.get(entity, {}).get('state') == value, state_attr=lambda entity, attr: self.entities.get(entity, {}).get(attr), now=lambda: datetime.fromtimestamp(self.clock, timezone.utc), as_timestamp=self.timestamp)
        self.variables = self.blueprint['variables']

    def timestamp(self, value, default=0):
        try: return value.timestamp() if isinstance(value, datetime) else datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
        except (ValueError, TypeError, AttributeError): return default

    def render(self, value, trigger):
        return self.env.from_string(value).render(**self.variables, trigger=SimpleNamespace(id=trigger)) if isinstance(value, str) and '{{' in value else value

    def sequence(self, actions, trigger):
        for item in actions:
            if 'choose' in item:
                for branch in item['choose']:
                    if self.render(branch['conditions'], trigger):
                        self.sequence(branch['sequence'], trigger)
                        break
            elif 'if' in item:
                self.sequence(item.get('then' if self.render(item['if'], trigger) else 'else', []), trigger)
            else:
                action = item['action']
                entity = item['target']['entity_id']
                data = {key: self.render(value, trigger) for key, value in item.get('data', {}).items()}
                self.calls.append((action, entity, data))
                if action == 'input_text.set_value': self.entities[entity]['state'] = str(data['value'])
                elif action == 'timer.cancel': self.entities[entity]['state'] = 'idle'
                elif action == 'fan.turn_off': self.entities[entity]['state'] = 'off'
                else: raise AssertionError(f'Unexpected service {action}')

    def fire(self, kind):
        triggers = self.blueprint['triggers']
        match = next((item for item in triggers if item.get('event_type') == kind), None)
        trigger = match['id'] if match else kind
        self.sequence(self.blueprint['actions'], trigger)

    def start(self, seconds=1800):
        self.entities[TIMER] = {'state': 'active', 'finishes_at': datetime.fromtimestamp(self.clock + seconds, timezone.utc).isoformat()}
        self.fire('timer.started')

class ShutdownBlueprintTests(unittest.TestCase):
    def test_first_start_initializes_an_unknown_helper(self):
        sim = BlueprintSimulation(); sim.entities[DEADLINE]['state'] = 'unknown'; sim.start()
        self.assertEqual(sim.entities[DEADLINE]['state'], str(sim.clock + 1800))

    def test_start_and_finish(self):
        sim = BlueprintSimulation(); sim.start()
        self.assertEqual(sim.entities[DEADLINE]['state'], str(sim.clock + 1800))
        self.assertEqual(sim.entities[FAN]['state'], 'on')
        sim.clock += 1800; sim.entities[TIMER]['state'] = 'idle'; sim.fire('timer.finished')
        self.assertEqual(sim.entities[FAN]['state'], 'off')
        self.assertEqual(sim.entities[DEADLINE]['state'], '')

    def test_expired_while_ha_was_offline(self):
        sim = BlueprintSimulation(); sim.start(60)
        sim.clock += 300; sim.entities[TIMER]['state'] = 'idle'; sim.fire('reconcile')
        self.assertEqual(sim.entities[FAN]['state'], 'off')

    def test_future_deadline_survives_reconciliation(self):
        sim = BlueprintSimulation(); sim.start(); sim.fire('reconcile')
        self.assertEqual(sim.entities[FAN]['state'], 'on')
        self.assertEqual(sim.entities[TIMER]['state'], 'active')

    def test_restart_uses_latest_deadline(self):
        sim = BlueprintSimulation(); sim.start(60); sim.start(3600)
        sim.fire('timer.restarted'); sim.clock += 100; sim.fire('reconcile')
        self.assertEqual(sim.entities[FAN]['state'], 'on')
        self.assertEqual(sim.entities[DEADLINE]['state'], str(sim.clock - 100 + 3600))

    def test_cancel_never_turns_off_the_fan(self):
        sim = BlueprintSimulation(); sim.start(); sim.entities[TIMER]['state'] = 'idle'; sim.fire('timer.cancelled')
        sim.clock += 7200; sim.fire('reconcile')
        self.assertEqual(sim.entities[FAN]['state'], 'on')
        self.assertEqual(sim.entities[DEADLINE]['state'], '')

    def test_off_cancels_and_mode_changes_do_not(self):
        sim = BlueprintSimulation(); sim.start(); sim.entities[FAN]['preset_mode'] = 'Silent'; sim.fire('reconcile')
        self.assertEqual(sim.entities[TIMER]['state'], 'active')
        sim.entities[FAN]['state'] = 'off'; sim.fire('off')
        self.assertEqual(sim.entities[TIMER]['state'], 'idle')
        self.assertEqual(sim.entities[DEADLINE]['state'], '')

    def test_paused_timer_never_expires(self):
        sim = BlueprintSimulation(); sim.start(60); sim.entities[TIMER]['state'] = 'paused'; sim.fire('timer.paused')
        sim.clock += 300; sim.fire('reconcile')
        self.assertEqual(sim.entities[FAN]['state'], 'on')
        self.assertEqual(sim.entities[DEADLINE]['state'], '')

    def test_start_preserves_intent_during_a_brief_availability_transition(self):
        sim = BlueprintSimulation(); sim.entities[FAN]['state'] = 'unavailable'; sim.start(60)
        self.assertEqual(sim.entities[DEADLINE]['state'], str(sim.clock + 60))
        sim.clock += 120; sim.entities[TIMER]['state'] = 'idle'; sim.entities[FAN]['state'] = 'on'; sim.fire('reconcile')
        self.assertEqual(sim.entities[FAN]['state'], 'off')

    def test_unavailable_fan_retries_when_available(self):
        sim = BlueprintSimulation(); sim.start(60); sim.entities[FAN]['state'] = 'unavailable'
        sim.clock += 300; sim.entities[TIMER]['state'] = 'idle'; sim.fire('reconcile')
        self.assertNotEqual(sim.entities[DEADLINE]['state'], '')
        sim.entities[FAN]['state'] = 'on'; sim.fire('reconcile')
        self.assertEqual(sim.entities[FAN]['state'], 'off')

    def test_cancel_deadline_cleared_while_automation_disabled(self):
        sim = BlueprintSimulation(); sim.start(); sim.entities[DEADLINE]['state'] = ''; sim.fire('reconcile')
        self.assertEqual(sim.entities[TIMER]['state'], 'idle')
        sim.clock += 7200; sim.fire('reconcile')
        self.assertEqual(sim.entities[FAN]['state'], 'on')

    def test_stale_finished_event_does_not_kill_a_restarted_timer(self):
        sim = BlueprintSimulation(); sim.start(60); sim.clock += 60; sim.start(3600); sim.fire('timer.finished')
        self.assertEqual(sim.entities[FAN]['state'], 'on')
        self.assertEqual(sim.entities[TIMER]['state'], 'active')

    def test_stale_cancel_event_does_not_clear_a_new_deadline(self):
        sim = BlueprintSimulation(); sim.start(3600); sim.fire('timer.cancelled')
        self.assertNotEqual(sim.entities[DEADLINE]['state'], '')

    def test_stale_off_event_does_not_cancel_a_new_schedule(self):
        sim = BlueprintSimulation(); sim.start(3600); sim.fire('off')
        self.assertEqual(sim.entities[TIMER]['state'], 'active')

    def test_external_start_while_off_is_cancelled(self):
        sim = BlueprintSimulation(); sim.entities[FAN]['state'] = 'off'; sim.start()
        self.assertEqual(sim.entities[TIMER]['state'], 'idle')
        self.assertEqual(sim.entities[DEADLINE]['state'], '')

if __name__ == '__main__': unittest.main()
