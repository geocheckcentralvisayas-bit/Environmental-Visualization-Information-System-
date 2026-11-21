'use client';

import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useSafeMotion } from '../hooks/use-safe-motion';
import { motionTokens, springs } from '../lib/motion-tokens';

/** Keyed page switch: old page leaves before the new one enters. */
export function PageTransition({ pageKey, children }: { pageKey: string; children: ReactNode }) {
  const safe = useSafeMotion(motionTokens.distance.sm);
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pageKey}
        initial={safe.initial}
        animate={safe.enter}
        exit={safe.exit}
        transition={{ duration: motionTokens.duration.normal, ease: motionTokens.easing.smooth }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Parent that reveals children in sequence. Use with <StaggerItem>. */
export function Stagger({
  children,
  className,
  staggerChildren = 0.08,
  delayChildren = 0.06,
}: {
  children: ReactNode;
  className?: string;
  staggerChildren?: number;
  delayChildren?: number;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren, delayChildren } } }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const safe = useSafeMotion(motionTokens.distance.sm);
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: safe.initial.opacity, y: safe.initial.y },
        show: { opacity: 1, y: 0 },
      }}
      transition={springs.gentle}
    >
      {children}
    </motion.div>
  );
}
