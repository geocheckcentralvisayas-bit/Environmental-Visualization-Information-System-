import ReactECharts from 'echarts-for-react';
import { useReducedMotion } from 'motion/react';
import type { EChartsOption } from 'echarts';
import clsx from 'clsx';

export function chartBase(overrides: Partial<EChartsOption> = {}): EChartsOption {
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'Inter', color: '#94a3b8', fontSize: 11 },
    animationDuration: 500,
    animationEasing: 'cubicOut',
    grid: { left: 12, right: 16, top: 28, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(5, 14, 11, 0.96)',
      borderColor: 'rgba(52, 211, 153, 0.24)',
      borderWidth: 1,
      padding: [8, 11],
      textStyle: { color: '#e2e8f0', fontSize: 11.5, fontFamily: 'Inter' },
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(148, 163, 184, 0.06)' } },
      extraCssText: 'border-radius:10px;box-shadow:0 16px 34px rgba(0,0,0,.55);',
    },
    ...overrides,
  } as EChartsOption;
}

export function axisStyle(extra: Record<string, unknown> = {}): any {
  return {
    axisLine: { lineStyle: { color: 'rgba(148,163,184,0.16)' } },
    axisTick: { show: false },
    axisLabel: { color: '#7d948d', fontSize: 10.5, fontFamily: 'Inter' },
    splitLine: { lineStyle: { color: 'rgba(148,163,184,0.08)', type: 'dashed' } },
    ...extra,
  };
}

export function Chart({
  option,
  height = 280,
  className,
  onEvents,
  ariaLabel,
}: {
  option: any;
  height?: number | string;
  className?: string;
  onEvents?: Record<string, (params: unknown) => void>;
  ariaLabel?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <div role="img" aria-label={ariaLabel ?? 'Chart'} className={clsx('w-full', className)} style={{ height }}>
      <ReactECharts
        option={{ animation: !reduce, ...option }}
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'canvas' }}
        notMerge
        lazyUpdate
        onEvents={onEvents}
      />
    </div>
  );
}
