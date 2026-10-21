// Minimal event emitter shared by the signaling backends, the links and the room.
export class Emitter {
  #handlers = Object.create(null);

  /** Subscribes `fn` to `type` ; returns the function that unsubscribes it. */
  on(type, fn) {
    (this.#handlers[type] ??= []).push(fn);
    return () => {
      const list = this.#handlers[type];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  emit(type, value) {
    const list = this.#handlers[type];
    if (!list) return;
    for (const fn of list.slice()) fn(value);
  }
}
