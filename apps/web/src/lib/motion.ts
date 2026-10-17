export const easeOut = [0.16, 1, 0.3, 1] as const;
export const dur = { fast: 0.16, base: 0.24, slow: 0.6, reveal: 0.9 };

export const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: dur.slow, ease: easeOut } },
};

export const stagger = (s = 0.06, d = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren: s, delayChildren: d } },
});
