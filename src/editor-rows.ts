/** Keep native details/input nodes stable across config echoes and reordering. */
export class EditorRows {
  public keys: string[] = [];
  private sequence = 0;

  public sync<T>(previous: T[], next: T[], identity: (row: T) => string) {
    const matches: Array<number | undefined> = next.map(() => undefined);
    const used = new Set<number>();
    const match = (compare: (a: T, b: T) => boolean) => {
      next.forEach((row, index) => {
        if (matches[index] !== undefined) return;
        const found = previous.findIndex(
          (old, i) => !used.has(i) && compare(row, old),
        );
        if (found >= 0) {
          matches[index] = found;
          used.add(found);
        }
      });
    };
    match((a, b) => JSON.stringify(a) === JSON.stringify(b));
    match((a, b) => !!identity(a) && identity(a) === identity(b));
    this.keys = next.map((_, index) => {
      let old = matches[index];
      if (old === undefined && index < previous.length && !used.has(index)) {
        old = index;
        used.add(index);
      }
      return (
        (old === undefined ? undefined : this.keys[old]) ??
        `row-${++this.sequence}`
      );
    });
  }
}
