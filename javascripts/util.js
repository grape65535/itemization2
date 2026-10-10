'use strict';

const Util = {
  _idCounter: 0,

  newId() {
    Util._idCounter = (Util._idCounter + 1) % 1679616;
    return Date.now().toString(36) + Util._idCounter.toString(36) + Math.random().toString(36).slice(2, 7);
  },

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  },

  el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  },

  isTextInput(target) {
    return !!target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
  },
};
