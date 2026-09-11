import {
  Check,
  CheckCircle2,
  CircleDot,
  createIcons,
  Dices,
  FlaskConical,
  Gauge,
  KeyRound,
  LoaderCircle,
  Play,
  RotateCcw,
  ShieldAlert,
  Square,
  StepForward,
  WrapText,
  X,
  XCircle,
} from 'lucide';

const icons = {
  Check,
  CheckCircle2,
  CircleDot,
  Dices,
  FlaskConical,
  Gauge,
  KeyRound,
  LoaderCircle,
  Play,
  RotateCcw,
  ShieldAlert,
  Square,
  StepForward,
  WrapText,
  X,
  XCircle,
};

export function hydrateIcons(root: HTMLElement | Document = document): void {
  createIcons({
    icons,
    attrs: { 'aria-hidden': 'true', 'stroke-width': '2' },
    nameAttr: 'data-lucide',
    root,
  });
}