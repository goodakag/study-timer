// Odometer-style text: only characters that change roll in.
export function createRoller(el) {
  let chars = [];
  let current = '';
  return {
    set(text, { animate = true } = {}) {
      if (text === current) return;
      if (text.length !== current.length) {
        el.innerHTML = '';
        chars = [...text].map((ch) => {
          const s = document.createElement('span');
          s.className = ch === ':' ? 'rc colon' : 'rc';
          s.textContent = ch;
          el.append(s);
          return s;
        });
        current = text;
        return;
      }
      for (let i = 0; i < text.length; i++) {
        if (text[i] === current[i]) continue;
        const s = chars[i];
        s.textContent = text[i];
        if (animate && !document.hidden) {
          s.classList.remove('roll');
          void s.offsetWidth;
          s.classList.add('roll');
        }
      }
      current = text;
    },
  };
}
