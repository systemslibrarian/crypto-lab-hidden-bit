import type { Page } from '@playwright/test';

export interface ContrastFailure {
  selector: string;
  text: string;
  ratio: number;
  required: number;
  foreground: string;
  background: string;
}

export async function auditContrast(page: Page): Promise<ContrastFailure[]> {
  return page.evaluate(() => {
    interface Color { r: number; g: number; b: number; a: number }
    const transparent: Color = { r: 0, g: 0, b: 0, a: 0 };
    const white: Color = { r: 255, g: 255, b: 255, a: 1 };
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;

    const resolve = (value: string): Color | null => {
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
    const ratio = (left: Color, right: Color): number => {
      const l1 = luminance(left);
      const l2 = luminance(right);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const selector = (element: Element): string => {
      const id = element.id ? `#${element.id}` : '';
      const classes = (element.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).join('.');
      return `${element.tagName.toLowerCase()}${id}${classes ? `.${classes}` : ''}`;
    };
    const background = (element: Element): Color => {
      const paints: Color[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        const paint = resolve(getComputedStyle(node).backgroundColor);
        if (paint && paint.a > 0) paints.push(paint);
      }
      let result = white;
      for (const paint of paints.reverse()) result = over(paint, result);
      return result;
    };
    const failures: ContrastFailure[] = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (!element.checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (element.closest('[aria-hidden="true"]')) continue;
      if (element.matches(':disabled')) continue;
      const ownText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join(' ')
        .trim();
      if (!ownText) continue;
      const style = getComputedStyle(element);
      const ink = resolve(style.color);
      if (!ink || ink.a === 0) continue;
      const surface = background(element);
      const foreground = over(ink, surface);
      const fontSize = Number.parseFloat(style.fontSize);
      const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
      const required = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
      const measured = Math.round(ratio(foreground, surface) * 100) / 100;
      if (measured < required) {
        failures.push({
          selector: selector(element),
          text: ownText.slice(0, 80),
          ratio: measured,
          required,
          foreground: style.color,
          background: style.backgroundColor,
        });
      }
    }
    return failures;
  });
}

export function formatContrastFailures(failures: ContrastFailure[]): string[] {
  return failures.map(
    (failure) =>
      `${failure.selector} "${failure.text}" ${failure.ratio}:1 (needs ${failure.required}:1), ` +
      `${failure.foreground} on ${failure.background}`,
  );
}