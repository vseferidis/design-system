// SYNC-MANAGED: variant definitions — edit via Figma sync app, then implement logic in ui-button.ts

export type UIButtonVariant = 'primary' | 'secondary' | 'ghost';
export type UIButtonSize = 'sm' | 'md' | 'lg';

export type UIButtonVariant = 'Primary' | 'Secondary' | 'Ghost';

export type UIButtonSize = 'MD' | 'SM' | 'LG';

export type UIButtonState = 'Default' | 'Hover' | 'Disabled';

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
  'icon-left'?: string;
  'icon-right'?: string;
}
