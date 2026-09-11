import type { Page } from '@playwright/test';

export interface NonTextFailure {
  kind: 'control-boundary' | 'generated-content';
  selector: string;
  ratio: number;
  required: number;
  detail: string;
}

export async function auditNonText(page: Page): Promise<NonTextFailure[]> {
  return page.evaluate(() => {
    interface Color { r: number; g: number; b: number; a: number }
    const transparent: Color = { r: 0, g: 0, b: 0, a: 0 };
    const white: Color = { r: 255, g: 255, b: 255, a: 1 };
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const resolve = (value: string): Color | null => {
      if (!value) return null;
      context.fillStyle = '#000';
      context.fillStyle = value;
      const dark = context.fillStyle;
      context.fillStyle = '#fff';
      context.fillStyle = value;
      if (context.fillStyle !== dark) return null;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const data = context.getImageData(0, 0, 1, 1).data;
      return { r: data[0]!, g: data[1]!, b: data[2]!, a: data[3]! / 255 };
    };
    const over = (source: Color, destination: Color): Color => {
      const alpha = source.a + destination.a * (1 - source.a);
      if (alpha === 0) return transparent;
      return {
        r: (source.r * source.a + destination.r * destination.a * (1 - source.a)) / alpha,
        g: (source.g * source.a + destination.g * destination.a * (1 - source.a)) / alpha,
        b: (source.b * source.a + destination.b * destination.a * (1 - source.a)) / alpha,
        a: alpha,
      };
    };
    const luminance = (color: Color): number => {
      const channel = (value: number): number => {
        const normalized = value / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };
    const contrast = (left: Color, right: Color): number => {
      const l1 = luminance(left);
      const l2 = luminance(right);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const selector = (element: Element): string => {
      const id = element.id ? `#${element.id}` : '';
      const classes = (element.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).join('.');
      return `${element.tagName.toLowerCase()}${id}${classes ? `.${classes}` : ''}`;
    };
    const backdrop = (element: Element | null): Color => {
      const paints: Color[] = [];
      for (let node = element; node; node = node.parentElement) {
        const paint = resolve(getComputedStyle(node).backgroundColor);
        if (paint && paint.a > 0) paints.push(paint);
      }
      let result = white;
      for (const paint of paints.reverse()) result = over(paint, result);
      return result;
    };
    const failures: NonTextFailure[] = [];
    const controls = document.querySelectorAll<HTMLElement>(
      'button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=checkbox],[role=radio],[role=slider],a.cl-btn',
    );
    for (const element of Array.from(controls)) {
      if (!element.checkVisibility?.() || (element as HTMLButtonElement).disabled) continue;
      const style = getComputedStyle(element);
      const surround = backdrop(element.parentElement);
      const own = resolve(style.backgroundColor) ?? transparent;
      const fill = over(own, surround);
      let best = own.a > 0 ? contrast(fill, surround) : 1;
      let detail = `fill ${best.toFixed(2)}:1`;
      const sides = ['top', 'right', 'bottom', 'left'] as const;
      for (const side of sides) {
        const width = Number.parseFloat(style.getPropertyValue(`border-${side}-width`));
        const borderStyle = style.getPropertyValue(`border-${side}-style`);
        const color = resolve(style.getPropertyValue(`border-${side}-color`));
        if (width <= 0 || borderStyle === 'none' || !color || color.a === 0) continue;
        const measured = contrast(over(color, fill), surround);
        if (measured > best) {
          best = measured;
          detail = `border-${side} ${measured.toFixed(2)}:1`;
        }
      }
      const nativeType = (element as HTMLInputElement).type;
      if (style.appearance !== 'none' && ['checkbox', 'radio', 'range', 'color', 'file'].includes(nativeType)) continue;
      const rounded = Math.round(best * 100) / 100;
      if (rounded < 3) {
        failures.push({ kind: 'control-boundary', selector: selector(element), ratio: rounded, required: 3, detail });
      }
    }
    const empty = new Set(['none', 'normal', '""', "''"]);
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (!element.checkVisibility?.()) continue;
      for (const pseudo of ['::before', '::after']) {
        const style = getComputedStyle(element, pseudo);
        if (empty.has(style.content.trim()) || style.content.startsWith('url(')) continue;
        const ink = resolve(style.color);
        if (!ink || ink.a === 0) continue;
        const surface = backdrop(element);
        const measured = Math.round(contrast(over(ink, surface), surface) * 100) / 100;
        const fontSize = Number.parseFloat(style.fontSize);
        const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
        const required = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
        if (measured < required) {
          failures.push({
            kind: 'generated-content',
            selector: `${selector(element)}${pseudo}`,
            ratio: measured,
            required,
            detail: `generated ${style.content}`,
          });
        }
      }
    }
    return failures;
  });
}

export function formatNonTextFailures(failures: NonTextFailure[]): string[] {
  return failures.map(
    (failure) => `${failure.kind} ${failure.selector}: ${failure.ratio}:1 (needs ${failure.required}:1), ${failure.detail}`,
  );
}