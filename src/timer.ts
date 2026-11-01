import type { HassEntities } from 'home-assistant-js-websocket';
import type { PurifierShutdownTimer } from './types';

export function shutdownState(
  states: HassEntities,
  config: PurifierShutdownTimer,
  now = Date.now(),
) {
  const timer = states[config.entity_id ?? ''];
  const automation = states[config.automation_entity_id ?? ''];
  const deadlineEntity = states[config.deadline_entity_id ?? ''];
  const deadline = Number(deadlineEntity?.state);
  const armed = Number.isFinite(deadline) && deadline > 0;
  const available =
    !!timer && !['unknown', 'unavailable'].includes(timer.state);
  // A new Text helper has no restored value yet. It is writable while unknown;
  // the automation initializes it when the first timer starts.
  const deadlineAvailable =
    !!deadlineEntity && deadlineEntity.state !== 'unavailable';
  const ready = available && deadlineAvailable && automation?.state === 'on';
  const finishesAt = Date.parse(String(timer?.attributes.finishes_at ?? ''));
  const paused = timer?.state === 'paused';
  const pausedSeconds = parseDuration(timer?.attributes.remaining);
  const seconds = paused
    ? pausedSeconds
    : armed
      ? Math.max(0, Math.ceil(deadline - now / 1000))
      : Number.isFinite(finishesAt)
        ? Math.max(0, Math.ceil((finishesAt - now) / 1000))
        : undefined;
  return {
    ready,
    available,
    deadlineAvailable,
    armed,
    paused,
    active: timer?.state === 'active',
    seconds,
    waiting: armed && !paused && deadline <= now / 1000,
    backendEnabled: automation?.state === 'on',
    visible: armed || timer?.state === 'active' || paused,
  };
}

export function parseDuration(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d+:\d{2}:\d{2}$/.test(value))
    return undefined;
  const [hours, minutes, seconds] = value.split(':').map(Number);
  if (minutes > 59 || seconds > 59) return undefined;
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatCountdown(seconds?: number) {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—';
  const value = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(value / 60);
  const tail = String(value % 60).padStart(2, '0');
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${tail}`
    : `${minutes}:${tail}`;
}
