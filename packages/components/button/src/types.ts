// SYNC-MANAGED: variant definitions — edit via Figma sync app, then implement logic in ui-button.ts

export type UIButtonVariant = 'primary' | 'secondary' | 'ghost';
export type UIButtonSize = 'sm' | 'md' | 'lg';

export interface UIButtonSlots {
  default: true;
  'icon-left': true;
  'icon-right': true;
}

export interface UIButtonAttributes {
  variant: UIButtonVariant;
  size: UIButtonSize;
  disabled: boolean;
  loading: boolean;
}
