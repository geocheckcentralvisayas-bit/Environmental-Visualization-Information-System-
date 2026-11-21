'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { motionConfig, motionTokens } from '../lib/motion-tokens';

/** Client-only mount guard plus reduced-motion-aware enter/exit states. */
export function useSafeMotion(y = motionTokens.distance.md) {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const animate = Boolean(mounted) && motionConfig.shouldAnimate() && !reduce;

  return {
    animate,
    initial: { opacity: animate ? 0 : 1, y: animate ? y : 0 },
    enter: { opacity: 1, y: 0 },
    exit: { opacity: animate ? 0 : 1, y: animate ? -y : 0 },
  };
}
