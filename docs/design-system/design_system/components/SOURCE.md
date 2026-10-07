# Component source (reference)

These are the reference implementations, concatenated so the compiler of the parent project does not index them twice. Each block is the original `components/<group>/<Name>.jsx`.


### Alert.d.ts

```ts
export interface AlertProps { variant?: 'default' | 'destructive' | 'warning' | 'success'; title?: string; /** override lucide icon */ icon?: string; action?: React.ReactNode; children?: React.ReactNode; style?: React.CSSProperties }
export function Alert(props: AlertProps): JSX.Element;

```

## components/display/Alert.jsx

```jsx
import React from 'react';
import { Icon } from './Icon.jsx';
const V = { default: { color: 'var(--text-secondary)', icon: 'info' }, destructive: { color: 'var(--danger)', icon: 'circle-alert' }, warning: { color: 'var(--warning)', icon: 'triangle-alert' }, success: { color: 'var(--success)', icon: 'circle-check' } };
/** White, hairline border; the icon alone carries the tone. */
export function Alert({ variant = 'default', title, icon, children, action, style }) {
  const v = V[variant] || V.default;
  return <div role="alert" style={{ width: '100%', boxSizing: 'border-box', borderRadius: 'var(--radius-card)', border: '1px solid var(--border)', background: 'var(--surface-card)', padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'flex-start', ...style }}>
    <span style={{ display: 'flex', marginTop: 2, color: v.color }}><Icon name={icon || v.icon} size={15} /></span>
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>{title && <h5 style={{ margin: 0, font: 'var(--type-label)', color: 'var(--text-body)' }}>{title}</h5>}{children && <div style={{ font: 'var(--type-body)', color: 'var(--text-secondary)' }}>{children}</div>}</div>
    {action}
  </div>;
}

```

### Avatar.d.ts

```ts
export interface AvatarProps { name?: string; src?: string; size?: 'sm' | 'md' | 'lg'; /** fallback colouring */ tone?: 'soft' | 'mint' | 'neutral'; style?: React.CSSProperties }
export function Avatar(props: AvatarProps): JSX.Element;

```

## components/display/Avatar.jsx

```jsx
import React from 'react';
const S = { sm: 'var(--avatar-sm)', md: 'var(--avatar)', lg: 'var(--avatar-lg)' };
const initialsOf = n => (n || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
export function Avatar({ name, src, size = 'md', tone = 'soft', style }) {
  const d = S[size] || S.md;
  const base = { width: d, height: d, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', font: 'var(--type-label)', fontSize: size === 'lg' ? 16 : size === 'sm' ? 10 : 12, ...style };
  if (src) return <img src={src} alt={name || ''} style={{ ...base, objectFit: 'cover' }} />;
  const tones = { soft: ['var(--bg-secondary)', 'var(--gray-700)'], mint: ['var(--bg-secondary)', 'var(--gray-700)'], neutral: ['var(--bg-secondary)', 'var(--text-secondary)'] };
  const [bg, fg] = tones[tone] || tones.soft;
  return <span aria-label={name} style={{ ...base, background: bg, color: fg, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.06)', fontWeight: 500 }}>{initialsOf(name)}</span>;
}

```

### Badge.d.ts

```ts
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> { /** sets the dot colour */ variant?: 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'error' | 'info'; /** leading status dot (default true) */ dot?: boolean; /** soft tinted fill instead of white + hairline */ filled?: boolean; children?: React.ReactNode }
export function Badge(props: BadgeProps): JSX.Element;

```

## components/display/Badge.jsx

```jsx
import React from 'react';
const DOT = { default: 'var(--text-secondary)', secondary: 'var(--neutral-dot)', outline: 'var(--neutral-dot)', success: 'var(--success)', warning: 'var(--warning)', error: 'var(--danger)', info: 'var(--teal-500)' };
/** Status as text: a 6px dot and a word. No pill, no fill. `filled` = the one exception (e.g. Urgent). */
export function Badge({ variant = 'default', dot = true, filled, children, style, ...rest }) {
  const color = DOT[variant] || DOT.default;
  const fill = filled ? { background: variant === 'error' ? 'var(--danger)' : 'var(--ink)', color: '#fff', padding: '0 5px', borderRadius: 'var(--radius-badge)', fontSize: 11, lineHeight: '16px', letterSpacing: '.02em', fontWeight: 600 } : null;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: 'var(--type-caption)', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap', lineHeight: '16px', ...fill, ...style }} {...rest}>{dot && !filled && <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />}<span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span></span>;
}

```

### Card.d.ts

```ts
export interface CardProps extends React.HTMLAttributes<HTMLElement> { title?: React.ReactNode; description?: React.ReactNode; /** right-aligned header slot */ action?: React.ReactNode; footer?: React.ReactNode; /** panel = flat grey tint (default); outline = white with 1px border, for white-on-grey */ variant?: 'panel' | 'outline'; padding?: string | number; /** hover tint, renders a <button> */ interactive?: boolean; as?: string; children?: React.ReactNode }
export function Card(props: CardProps): JSX.Element;

```

## components/display/Card.jsx

```jsx
import React from 'react';
import { useStyle } from '../lib/styles.js';
const CSS = `.mana-card{border-radius:var(--radius-card);background:var(--surface-card);box-sizing:border-box;border:1px solid var(--border)}.mana-card-plain{border-color:transparent;background:transparent}.mana-card.is-interactive{cursor:pointer;text-align:left;transition:background var(--dur) var(--ease),border-color var(--dur) var(--ease)}.mana-card.is-interactive:hover{background:var(--surface-panel-hover);border-color:var(--border-strong)}.mana-card.is-interactive:focus-visible{outline:none;box-shadow:var(--ring)}`;
export function Card({ title, description, action, footer, variant = 'outline', padding = 'var(--card-pad)', interactive, as, style, children, ...rest }) {
  useStyle('mana-card-css', CSS);
  const Tag = as || (interactive ? 'button' : 'div');
  const hasHeader = title || description || action;
  return <Tag className={`mana-card mana-card-${variant} ${interactive ? 'is-interactive' : ''}`} style={{ padding, display: 'flex', flexDirection: 'column', width: Tag === 'button' ? '100%' : undefined, font: 'inherit', color: 'inherit', ...style }} {...rest}>
    {hasHeader && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: children ? 12 : 0 }}><div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>{title && <h3 style={{ margin: 0, font: 'var(--type-card-title)', letterSpacing: 'var(--tracking-tight)', color: 'var(--text-body)' }}>{title}</h3>}{description && <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{description}</p>}</div>{action}</div>}
    {children}
    {footer && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>{footer}</div>}
  </Tag>;
}

```

### EmptyState.d.ts

```ts
export interface EmptyStateProps { /** ignored — kept for compatibility */ icon?: string; title: string; description?: string; action?: React.ReactNode; style?: React.CSSProperties }
export function EmptyState(props: EmptyStateProps): JSX.Element;

```

## components/display/EmptyState.jsx

```jsx
import React from 'react';
/** Plain text, no box, no icon. Says what to do next in one sentence. */
export function EmptyState({ title, description, action, style }) {
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '24px 0', ...style }}>
    <h3 style={{ margin: 0, font: 'var(--type-body)', fontWeight: 500, color: 'var(--text-body)' }}>{title}</h3>
    {description && <p style={{ margin: '2px 0 0', maxWidth: 420, font: 'var(--type-body)', color: 'var(--text-muted)' }}>{description}</p>}
    {action && <div style={{ marginTop: 12 }}>{action}</div>}
  </div>;
}

```

### Icon.d.ts

```ts
export interface IconProps { /** Lucide icon name in kebab-case, e.g. "users", "calendar-days", "file-text" */ name: string; /** px, default 16 */ size?: number; title?: string; style?: React.CSSProperties; className?: string }
export function Icon(props: IconProps): JSX.Element;

```

## components/display/Icon.jsx

```jsx
import React from 'react';
import { iconCdn } from '../lib/styles.js';
const pascal = n => n.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
// lucide UMD icon nodes come either as [[tag, attrs], …] (new) or ['svg', attrs, [[tag, attrs], …]] (old).
const childrenOf = node => { if (!Array.isArray(node)) return null; if (node.length && Array.isArray(node[0])) return node; if (node[0] === 'svg' && Array.isArray(node[2])) return node[2]; return null; };
/** Lucide icon. Renders inline SVG when the lucide UMD (window.lucide) is loaded, otherwise a currentColor mask from the CDN. name = kebab-case lucide name. */
export function Icon({ name, size = 16, strokeWidth = 2, style, className, title }) {
  const lib = typeof window !== 'undefined' && window.lucide && window.lucide.icons;
  const kids = lib ? childrenOf(lib[pascal(name)]) : null;
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };
  if (kids) {
    return <svg {...a11y} className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}>{kids.map((k, i) => Array.isArray(k) ? React.createElement(k[0], { key: i, ...(k[1] || {}) }) : null)}</svg>;
  }
  const url = `url(${iconCdn}${name}.svg)`;
  return <span {...a11y} className={className} style={{ display: 'inline-block', flexShrink: 0, width: size, height: size, backgroundColor: 'currentColor', WebkitMask: `${url} center / contain no-repeat`, mask: `${url} center / contain no-repeat`, ...style }} />;
}

```

### Skeleton.d.ts

```ts
export interface SkeletonProps { width?: string | number; height?: string | number; radius?: string | number; /** gradient sweep instead of pulse */ shimmer?: boolean; style?: React.CSSProperties }
export function Skeleton(props: SkeletonProps): JSX.Element;

```

## components/display/Skeleton.jsx

```jsx
import React from 'react';
export function Skeleton({ width = '100%', height = 16, radius = 'var(--radius-md)', shimmer, style }) {
  const base = shimmer ? { background: 'linear-gradient(90deg,var(--bg-secondary) 0%,var(--bg) 50%,var(--bg-secondary) 100%)', backgroundSize: '200% 100%', animation: 'mana-shimmer 2s linear infinite' } : { background: 'rgba(142,142,146,.2)', animation: 'mana-pulse 2s cubic-bezier(.4,0,.6,1) infinite' };
  return <div aria-hidden="true" style={{ width, height, borderRadius: radius, ...base, ...style }} />;
}

```

### StarToggle.d.ts

```ts
export interface StarToggleProps { isSpecialized: boolean; onToggle?: () => void; disabled?: boolean; size?: 'sm' | 'md' }
export function StarToggle(props: StarToggleProps): JSX.Element;

```

## components/display/StarToggle.jsx

```jsx
import React from 'react';
import { Tooltip } from './Tooltip.jsx';
export function StarToggle({ isSpecialized, onToggle, disabled, size = 'sm' }) {
  const px = size === 'md' ? 16 : 14;
  const label = isSpecialized ? 'Retirer la spécialisation' : 'Marquer comme spécialisé';
  return <Tooltip content={label}><button type="button" aria-label={label} aria-pressed={!!isSpecialized} disabled={disabled} onClick={e => { e.stopPropagation(); if (!disabled && onToggle) onToggle(); }} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, background: 'transparent', padding: 2, borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .5 : 1, color: isSpecialized ? 'var(--warning)' : 'var(--gray-400)' }}>
    <svg width={px} height={px} viewBox="0 0 24 24" fill={isSpecialized ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
  </button></Tooltip>;
}

```

### StatusIndicator.d.ts

```ts
export interface StatusIndicatorProps { label: string; status?: 'complete' | 'pending' | 'warning'; description?: string; style?: React.CSSProperties }
export function StatusIndicator(props: StatusIndicatorProps): JSX.Element;

```

## components/display/StatusIndicator.jsx

```jsx
import React from 'react';
import { Icon } from './Icon.jsx';
const S = { complete: ['var(--success)', 'circle-check'], warning: ['var(--danger)', 'circle-alert'], pending: ['var(--warning)', 'clock'] };
export function StatusIndicator({ label, status = 'pending', description, style }) {
  const [color, icon] = S[status] || S.pending;
  return <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-light)', ...style }}>
    <span style={{ marginTop: 1, color, display: 'flex', flexShrink: 0 }}><Icon name={icon} size={14} /></span>
    <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}><p style={{ margin: 0, font: 'var(--type-body)', color: 'var(--text-body)' }}>{label}</p>{description && <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{description}</p>}</div>
  </div>;
}

```

### Tooltip.d.ts

```ts
export interface TooltipProps { content: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; open?: boolean; children: React.ReactNode }
export function Tooltip(props: TooltipProps): JSX.Element;

```

## components/display/Tooltip.jsx

```jsx
import React from 'react';
export function Tooltip({ content, side = 'top', open, children }) {
  const [hover, setHover] = React.useState(false);
  const show = open ?? hover;
  const pos = { top: { bottom: '100%', left: '50%', transform: 'translate(-50%,-4px)' }, bottom: { top: '100%', left: '50%', transform: 'translate(-50%,4px)' }, right: { left: '100%', top: '50%', transform: 'translate(4px,-50%)' }, left: { right: '100%', top: '50%', transform: 'translate(-4px,-50%)' } }[side];
  return <span style={{ position: 'relative', display: 'inline-flex' }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
    {children}
    {show && <span role="tooltip" style={{ position: 'absolute', zIndex: 50, whiteSpace: 'nowrap', borderRadius: 'var(--radius-sm)', background: 'var(--gray-900)', color: '#fff', padding: '3px 7px', font: 'var(--type-caption)', boxShadow: 'var(--shadow-medium)', animation: 'mana-zoom-in var(--dur-fast) var(--ease-out)', pointerEvents: 'none', ...pos }}>{content}</span>}
  </span>;
}

```

### Button.d.ts

```ts
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** default = teal action (one per view); ink = black for the page's main create action if teal is already used */
  variant?: 'default' | 'ink' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link';
  /** 32px default, 28 sm, 36 lg, square icon / icon-sm */
  size?: 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm';
  fullWidth?: boolean;
  as?: 'button' | 'a' | 'div';
  children?: React.ReactNode;
}
export function Button(props: ButtonProps): JSX.Element;

```

## components/forms/Button.jsx

```jsx
import React from 'react';
import { useStyle } from '../lib/styles.js';
const CSS = `
.mana-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;border-radius:var(--radius-button);font:var(--type-label);cursor:pointer;border:1px solid transparent;transition:background var(--dur) var(--ease),border-color var(--dur) var(--ease),color var(--dur) var(--ease);outline:none;text-decoration:none;box-sizing:border-box}
.mana-btn:focus-visible{box-shadow:var(--ring)}
.mana-btn:disabled{pointer-events:none;opacity:.5}
.mana-btn-default{background:var(--primary);color:var(--primary-fg)}.mana-btn-default:hover{background:var(--primary-hover)}.mana-btn-default:active{background:var(--primary-active)}
.mana-btn-ink{background:var(--ink);color:#fff}.mana-btn-ink:hover{background:var(--ink-hover)}
.mana-btn-secondary{background:var(--bg-secondary);color:var(--text-body)}.mana-btn-secondary:hover{background:var(--bg-tertiary)}
.mana-btn-outline{background:var(--surface-card);color:var(--text-body);border-color:var(--border)}.mana-btn-outline:hover{border-color:var(--border-strong);background:var(--gray-50)}
.mana-btn-ghost{background:transparent;color:var(--text-secondary)}.mana-btn-ghost:hover{background:var(--bg-secondary);color:var(--text-body)}
.mana-btn-destructive{background:var(--danger);color:#fff}.mana-btn-destructive:hover{background:var(--danger-hover)}
.mana-btn-link{background:transparent;color:var(--text-link);text-underline-offset:3px;padding:0;height:auto}.mana-btn-link:hover{text-decoration:underline}
`;
const SIZES = { default: { height: 'var(--control-h)', padding: '0 var(--control-px)' }, sm: { height: 'var(--control-h-sm)', padding: '0 var(--control-px-sm)', fontSize: 'var(--text-xs)' }, lg: { height: 'var(--control-h-lg)', padding: '0 var(--control-px-lg)', fontSize: 'var(--text-base)' }, icon: { height: 'var(--control-h)', width: 'var(--control-h)', padding: 0 }, 'icon-sm': { height: 'var(--control-h-sm)', width: 'var(--control-h-sm)', padding: 0 } };
export function Button({ variant = 'default', size = 'default', fullWidth, as: Tag = 'button', style, className = '', children, ...rest }) {
  useStyle('mana-btn-css', CSS);
  const s = { ...SIZES[size] || SIZES.default, ...(fullWidth ? { width: '100%' } : null), ...style };
  return <Tag type={Tag === 'button' ? (rest.type || 'button') : undefined} className={`mana-btn mana-btn-${variant} ${className}`} style={s} {...rest}>{children}</Tag>;
}

```

### Checkbox.d.ts

```ts
export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> { label?: React.ReactNode; description?: string }
export function Checkbox(props: CheckboxProps): JSX.Element;

```

## components/forms/Checkbox.jsx

```jsx
import React from 'react';
import { useStyle } from '../lib/styles.js';
import { Icon } from '../display/Icon.jsx';
const CSS = `.mana-cb{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font:var(--type-body);color:var(--text-body)}.mana-cb input{position:absolute;opacity:0;width:0;height:0}.mana-cb-box{width:16px;height:16px;border-radius:var(--radius-sm);border:1px solid var(--border-strong);background:var(--surface-card);display:flex;align-items:center;justify-content:center;color:#fff;transition:all var(--dur-fast) var(--ease)}.mana-cb input:checked+.mana-cb-box{background:var(--primary);border-color:var(--primary)}.mana-cb input:focus-visible+.mana-cb-box{box-shadow:var(--ring)}.mana-cb.is-disabled{cursor:not-allowed;opacity:.5}`;
export function Checkbox({ checked, defaultChecked, onChange, disabled, label, description, style, ...rest }) {
  useStyle('mana-cb-css', CSS);
  return <label className={`mana-cb ${disabled ? 'is-disabled' : ''}`} style={{ alignItems: description ? 'flex-start' : 'center', ...style }}>
    <input type="checkbox" checked={checked} defaultChecked={defaultChecked} onChange={onChange} disabled={disabled} {...rest} />
    <span className="mana-cb-box" style={description ? { marginTop: 2 } : null}>{<Icon name="check" size={12} />}</span>
    {(label || description) && <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontWeight: description ? 500 : 400 }}>{label}</span>{description && <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{description}</span>}</span>}
  </label>;
}

```

### Input.d.ts

```ts
/** @startingPoint section="Forms" subtitle="Text field with optional leading icon and error" viewport="700x200" */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> { /** lucide icon name shown inside on the left (e.g. "search") */ icon?: string; /** error message rendered under the field; also sets aria-invalid */ error?: string; wrapStyle?: React.CSSProperties }
export function Input(props: InputProps): JSX.Element;

```

## components/forms/Input.jsx

```jsx
import React from 'react';
import { useStyle } from '../lib/styles.js';
import { Icon } from '../display/Icon.jsx';
const CSS = `.mana-input{display:flex;height:var(--control-h);width:100%;box-sizing:border-box;border-radius:var(--radius-input);border:1px solid var(--border);background:var(--surface-card);padding:0 10px;font:var(--type-body);color:var(--text-body);transition:border-color var(--dur) var(--ease),box-shadow var(--dur) var(--ease);outline:none}.mana-input::placeholder{color:var(--text-muted)}.mana-input:hover{border-color:var(--border-strong)}.mana-input:focus-visible{border-color:var(--primary);box-shadow:var(--ring-inset)}.mana-input:disabled{cursor:not-allowed;background:var(--bg-secondary);color:var(--text-secondary)}.mana-input[aria-invalid=true]{border-color:var(--danger)}`;
export function Input({ icon, error, style, wrapStyle, className = '', ...rest }) {
  useStyle('mana-input-css', CSS);
  const input = <input className={`mana-input ${className}`} aria-invalid={error ? true : undefined} style={{ ...(icon ? { paddingLeft: 30 } : null), ...style }} {...rest} />;
  return <div style={{ width: '100%', ...wrapStyle }}>{icon ? <div style={{ position: 'relative' }}><span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex' }}><Icon name={icon} size={14} /></span>{input}</div> : input}{error && <p role="alert" style={{ margin: '4px 0 0', font: 'var(--type-caption)', color: 'var(--danger)' }}>{error}</p>}</div>;
}

```

### Label.d.ts

```ts
export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> { required?: boolean; /** small muted text after the label, e.g. "(facultatif)" */ hint?: string; children?: React.ReactNode }
export function Label(props: LabelProps): JSX.Element;

```

## components/forms/Label.jsx

```jsx
import React from 'react';
export function Label({ children, required, hint, style, ...rest }) {
  return <label style={{ display: 'block', font: 'var(--type-label)', color: 'var(--text-body)', ...style }} {...rest}>{children}{required && <span aria-hidden="true" style={{ color: 'var(--primary)', marginLeft: 2 }}>*</span>}{hint && <span style={{ marginLeft: 6, font: 'var(--type-caption)', color: 'var(--text-muted)', fontWeight: 400 }}>{hint}</span>}</label>;
}

```

### Select.d.ts

```ts
export interface SelectOption { value: string; label: string }
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> { placeholder?: string; options?: Array<string | SelectOption>; }
export function Select(props: SelectProps): JSX.Element;

```

## components/forms/Select.jsx

```jsx
import React from 'react';
import { useStyle } from '../lib/styles.js';
import { Icon } from '../display/Icon.jsx';
const CSS = `.mana-select{appearance:none;display:flex;height:var(--control-h);width:100%;box-sizing:border-box;border-radius:var(--radius-input);border:1px solid var(--border);background:var(--surface-card);padding:0 28px 0 10px;font:var(--type-body);color:var(--text-body);transition:border-color var(--dur) var(--ease),box-shadow var(--dur) var(--ease);outline:none;cursor:pointer}.mana-select:hover{border-color:var(--border-strong)}.mana-select:focus-visible{border-color:var(--primary);box-shadow:var(--ring-inset)}.mana-select:disabled{cursor:not-allowed;background:var(--bg-secondary);color:var(--text-secondary)}.mana-select.is-placeholder{color:var(--text-muted)}`;
export function Select({ placeholder, options = [], value, className = '', style, children, ...rest }) {
  useStyle('mana-select-css', CSS);
  return <div style={{ position: 'relative', width: '100%', ...style }}>
    <select className={`mana-select ${!value && placeholder ? 'is-placeholder' : ''} ${className}`} value={value} {...rest}>
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {options.map(o => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
      {children}
    </select>
    <span style={{ pointerEvents: 'none', position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex' }}><Icon name="chevron-down" size={14} /></span>
  </div>;
}

```

### Switch.d.ts

```ts
export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> { label?: React.ReactNode }
export function Switch(props: SwitchProps): JSX.Element;

```

## components/forms/Switch.jsx

```jsx
import React from 'react';
import { useStyle } from '../lib/styles.js';
const CSS = `.mana-sw{position:relative;display:inline-flex;align-items:center;gap:10px;cursor:pointer;font:var(--type-body);color:var(--text-body)}.mana-sw input{position:absolute;opacity:0;width:0;height:0}.mana-sw-track{width:32px;height:18px;border-radius:9999px;background:var(--gray-300);border:2px solid transparent;box-sizing:border-box;transition:background var(--dur) var(--ease);flex-shrink:0}.mana-sw-thumb{display:block;width:14px;height:14px;border-radius:9999px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.15);transition:transform var(--dur) var(--ease)}.mana-sw input:checked+.mana-sw-track{background:var(--primary)}.mana-sw input:checked+.mana-sw-track .mana-sw-thumb{transform:translateX(14px)}.mana-sw input:focus-visible+.mana-sw-track{box-shadow:var(--ring)}.mana-sw.is-disabled{cursor:not-allowed;opacity:.5}`;
export function Switch({ checked, defaultChecked, onChange, disabled, label, style, ...rest }) {
  useStyle('mana-sw-css', CSS);
  return <label className={`mana-sw ${disabled ? 'is-disabled' : ''}`} style={style}>
    <input type="checkbox" role="switch" checked={checked} defaultChecked={defaultChecked} onChange={onChange} disabled={disabled} {...rest} />
    <span className="mana-sw-track"><span className="mana-sw-thumb" /></span>
    {label && <span>{label}</span>}
  </label>;
}

```

### Textarea.d.ts

```ts
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}
export function Textarea(props: TextareaProps): JSX.Element;

```

## components/forms/Textarea.jsx

```jsx
import React from 'react';
import { useStyle } from '../lib/styles.js';
const CSS = `.mana-textarea{display:flex;min-height:96px;width:100%;box-sizing:border-box;resize:vertical;border-radius:var(--radius-input);border:1px solid var(--border);background:var(--surface-card);padding:8px 10px;font:var(--type-body);color:var(--text-body);transition:border-color var(--dur) var(--ease),box-shadow var(--dur) var(--ease);outline:none}.mana-textarea::placeholder{color:var(--text-muted)}.mana-textarea:hover{border-color:var(--border-strong)}.mana-textarea:focus-visible{border-color:var(--primary);box-shadow:var(--ring-inset)}.mana-textarea:disabled{cursor:not-allowed;background:var(--bg-secondary)}`;
export function Textarea({ className = '', ...rest }) { useStyle('mana-textarea-css', CSS); return <textarea className={`mana-textarea ${className}`} {...rest} />; }

```

### AuthCard.d.ts

```ts
/** @startingPoint section="Layout" subtitle="Centered sign-in / reset card" viewport="700x560" */
export interface AuthCardProps { title: string; subtitle?: string; status?: React.ReactNode; statusMuted?: boolean; appName?: string; logoSrc?: string; /** min-height 100vh (default) */ fill?: boolean; children?: React.ReactNode; style?: React.CSSProperties }
export function AuthCard(props: AuthCardProps): JSX.Element;

```

## components/layout/AuthCard.jsx

```jsx
import React from 'react';
export function AuthCard({ title, subtitle, status, statusMuted, appName = 'Clinique MANA', logoSrc, fill = true, children, style }) {
  return <main style={{ display: 'flex', minHeight: fill ? '100vh' : undefined, alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '48px 16px', boxSizing: 'border-box', ...style }}>
    <div style={{ width: '100%', maxWidth: 360, boxSizing: 'border-box', borderRadius: 'var(--radius-card)', background: 'var(--surface-card)', border: '1px solid var(--border)', padding: 28 }}>
      {logoSrc ? <img src={logoSrc} alt={appName} style={{ height: 26, marginBottom: 20, display: 'block' }} /> : <p style={{ margin: '0 0 16px', font: 'var(--type-label)', color: 'var(--text-muted)' }}>{appName}</p>}
      <h1 tabIndex={-1} style={{ margin: 0, font: 'var(--type-section-title)', color: 'var(--text-body)', outline: 'none' }}>{title}</h1>
      {subtitle && <p style={{ margin: '4px 0 0', font: 'var(--type-body)', color: 'var(--text-secondary)' }}>{subtitle}</p>}
      <div role="status" aria-live="polite">{status && <p style={{ margin: '16px 0 0', font: 'var(--type-body)', ...(statusMuted ? { color: 'var(--text-muted)' } : { borderRadius: 'var(--radius-md)', background: 'var(--surface-card)', border: '1px solid var(--border)', padding: '8px 10px', color: 'var(--text-body)' }) }}>{status}</p>}</div>
      {children && <div style={{ marginTop: 20 }}>{children}</div>}
    </div>
  </main>;
}

```

### FullPageMessage.d.ts

```ts
export interface FullPageMessageProps { title: string; body?: string; action?: React.ReactNode; role?: 'alert' | 'status'; compact?: boolean; style?: React.CSSProperties }
export function FullPageMessage(props: FullPageMessageProps): JSX.Element;

```

## components/layout/FullPageMessage.jsx

```jsx
import React from 'react';
export function FullPageMessage({ title, body, action, role, compact, style }) {
  return <div role={role} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: compact ? '48px 16px' : '0 16px', minHeight: compact ? undefined : '60vh', ...style }}>
    <div style={{ maxWidth: 384, textAlign: 'center' }}>
      <h2 style={{ margin: 0, font: compact ? 'var(--type-card-title)' : 'var(--type-section-title)', color: 'var(--text-body)' }}>{title}</h2>
      {body && <p style={{ margin: '8px 0 0', font: 'var(--type-body)', color: 'var(--text-muted)' }}>{body}</p>}
      {action && <div style={{ marginTop: 24 }}>{action}</div>}
    </div>
  </div>;
}

```

## components/lib/styles.js

```jsx
// Injects a component's hover/focus CSS once per document. Components keep layout inline and use this only for pseudo-states.
export function useStyle(id, css) {
  if (typeof document === 'undefined') return;
  if (document.getElementById(id)) return;
  const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s);
}
export const iconCdn = 'https://unpkg.com/lucide-static@0.460.0/icons/';

```

### Accordion.d.ts

```ts
export interface AccordionItemDef { id: string; title: React.ReactNode; count?: number; content: React.ReactNode }
export interface AccordionProps { items: AccordionItemDef[]; defaultOpen?: string[]; multiple?: boolean; style?: React.CSSProperties }
export function Accordion(props: AccordionProps): JSX.Element;

```

## components/navigation/Accordion.jsx

```jsx
import React from 'react';
import { useStyle } from '../lib/styles.js';
import { Icon } from '../display/Icon.jsx';
const CSS = `.mana-acc-trigger{display:flex;flex:1;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:16px 0;border:0;background:transparent;font:var(--type-label);color:var(--text-body);cursor:pointer;text-align:left}.mana-acc-trigger:hover{text-decoration:underline}.mana-acc-trigger .mana-acc-chev{transition:transform var(--dur) var(--ease);color:var(--text-muted)}.mana-acc-trigger[aria-expanded=true] .mana-acc-chev{transform:rotate(180deg)}`;
export function Accordion({ items = [], defaultOpen = [], multiple = true, style }) {
  useStyle('mana-acc-css', CSS);
  const [open, setOpen] = React.useState(new Set(defaultOpen));
  const toggle = id => setOpen(prev => { const n = new Set(multiple ? prev : []); if (prev.has(id)) n.delete(id); else n.add(id); return n; });
  return <div style={style}>{items.map(it => <div key={it.id} style={{ borderBottom: '1px solid var(--border)' }}>
    <h3 style={{ margin: 0, display: 'flex' }}><button type="button" className="mana-acc-trigger" aria-expanded={open.has(it.id)} onClick={() => toggle(it.id)}><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{it.title}{it.count != null && <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)', fontWeight: 400 }}>{it.count}</span>}</span><span className="mana-acc-chev" style={{ display: 'flex' }}><Icon name="chevron-down" /></span></button></h3>
    {open.has(it.id) && <div style={{ paddingBottom: 16, font: 'var(--type-body)', color: 'var(--text-secondary)', animation: 'mana-fade-in var(--dur) var(--ease-out)' }}>{it.content}</div>}
  </div>)}</div>;
}

```

### CommandPalette.d.ts

```ts
export interface CommandItem { id?: string; label: string; icon?: string; hint?: string }
export interface CommandGroup { label: string; items: CommandItem[] }
export interface CommandPaletteProps { groups: CommandGroup[]; placeholder?: string; query?: string; onQueryChange?: (q: string) => void; onSelect?: (item: CommandItem) => void; emptyText?: string; style?: React.CSSProperties }
export function CommandPalette(props: CommandPaletteProps): JSX.Element;

```

## components/navigation/CommandPalette.jsx

```jsx
import React from 'react';
import { useStyle } from '../lib/styles.js';
import { Icon } from '../display/Icon.jsx';
const CSS = `.mana-cmd-item{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;border:0;background:transparent;border-radius:var(--radius-lg);padding:8px;font:var(--type-body);color:var(--text-body);cursor:pointer;text-align:left;outline:none}.mana-cmd-item:hover,.mana-cmd-item[aria-selected=true]{background:var(--bg-tertiary)}.mana-cmd-input{flex:1;height:40px;border:0;background:transparent;outline:none;font:var(--type-body);color:var(--text-body)}.mana-cmd-input::placeholder{color:var(--text-muted)}`;
export function CommandPalette({ groups = [], placeholder = 'Rechercher un client, un professionnel, une demande…', query: q, onQueryChange, onSelect, emptyText = 'Aucun résultat.', style }) {
  useStyle('mana-cmd-css', CSS);
  const [local, setLocal] = React.useState('');
  const query = q ?? local;
  const filtered = groups.map(g => ({ ...g, items: g.items.filter(it => !query || it.label.toLowerCase().includes(query.toLowerCase())) })).filter(g => g.items.length);
  return <div style={{ display: 'flex', flexDirection: 'column', width: '100%', borderRadius: 'var(--radius-menu)', background: 'var(--surface-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-large)', overflow: 'hidden', ...style }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', padding: '0 12px', color: 'var(--text-muted)' }}><Icon name="search" /><input className="mana-cmd-input" autoFocus placeholder={placeholder} value={query} onChange={e => { setLocal(e.target.value); onQueryChange && onQueryChange(e.target.value); }} /><kbd style={{ font: 'var(--type-caption)', fontFamily: 'var(--font-sans)', border: '1px solid var(--border)', borderRadius: 6, padding: '0 5px' }}>Esc</kbd></div>
    <div style={{ maxHeight: 300, overflowY: 'auto', padding: 4 }}>
      {filtered.length === 0 && <p style={{ padding: '24px 0', textAlign: 'center', font: 'var(--type-body)', color: 'var(--text-muted)', margin: 0 }}>{emptyText}</p>}
      {filtered.map((g, gi) => <div key={g.label} style={{ padding: 4 }}>{gi > 0 && <div style={{ height: 1, background: 'var(--border)', margin: '0 -8px 8px' }} />}<div style={{ padding: '6px 8px', font: 'var(--type-overline)', color: 'var(--text-muted)' }}>{g.label}</div>{g.items.map((it, i) => <button key={it.id || i} type="button" className="mana-cmd-item" aria-selected={gi === 0 && i === 0} onClick={() => onSelect && onSelect(it)}>{it.icon && <span style={{ color: 'var(--text-muted)', display: 'flex' }}><Icon name={it.icon} /></span>}<span style={{ flex: 1 }}>{it.label}</span>{it.hint && <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{it.hint}</span>}</button>)}</div>)}
    </div>
  </div>;
}

```

### DropdownMenu.d.ts

```ts
export interface MenuItem { label?: string; icon?: string; shortcut?: string; tone?: 'danger'; disabled?: boolean; type?: 'separator' | 'label'; onSelect?: () => void }
export interface DropdownMenuProps { trigger: React.ReactNode; items: Array<MenuItem | '-'>; align?: 'start' | 'end'; open?: boolean; onOpenChange?: (open: boolean) => void; style?: React.CSSProperties }
export function DropdownMenu(props: DropdownMenuProps): JSX.Element;

```

## components/navigation/DropdownMenu.jsx

```jsx
import React from 'react';
import { useStyle } from '../lib/styles.js';
import { Icon } from '../display/Icon.jsx';
const CSS = `.mana-menu-item{position:relative;display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;border:0;background:transparent;border-radius:var(--radius-lg);padding:6px 8px;font:var(--type-body);color:var(--text-body);cursor:pointer;text-align:left;outline:none;transition:background var(--dur-fast) var(--ease)}.mana-menu-item:hover,.mana-menu-item:focus-visible{background:var(--bg-secondary)}.mana-menu-item[data-tone=danger]{color:var(--danger)}.mana-menu-item:disabled{opacity:.5;pointer-events:none}`;
export function DropdownMenu({ trigger, items = [], align = 'end', open: openProp, onOpenChange, style }) {
  useStyle('mana-menu-css', CSS);
  const [openState, setOpen] = React.useState(false);
  const open = openProp ?? openState;
  const set = v => { setOpen(v); onOpenChange && onOpenChange(v); };
  const ref = React.useRef(null);
  React.useEffect(() => { if (!open) return; const h = e => { if (ref.current && !ref.current.contains(e.target)) set(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  return <div ref={ref} style={{ position: 'relative', display: 'inline-flex', ...style }}>
    <span onClick={() => set(!open)} style={{ display: 'inline-flex' }}>{trigger}</span>
    {open && <div role="menu" style={{ position: 'absolute', top: '100%', [align === 'end' ? 'right' : 'left']: 0, marginTop: 4, zIndex: 50, minWidth: 180, borderRadius: 'var(--radius-menu)', border: '1px solid var(--border)', background: 'var(--surface-card)', padding: 4, boxShadow: 'var(--shadow-medium)', animation: 'mana-zoom-in var(--dur-fast) var(--ease-out)' }}>
      {items.map((it, i) => it === '-' || it.type === 'separator' ? <div key={i} role="separator" style={{ height: 1, background: 'var(--border)', margin: '4px -4px' }} /> : it.type === 'label' ? <div key={i} style={{ padding: '6px 8px', font: 'var(--type-overline)', color: 'var(--text-muted)' }}>{it.label}</div> : <button key={i} type="button" role="menuitem" className="mana-menu-item" data-tone={it.tone} disabled={it.disabled} onClick={() => { set(false); it.onSelect && it.onSelect(); }}>{it.icon && <Icon name={it.icon} />}<span style={{ flex: 1 }}>{it.label}</span>{it.shortcut && <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{it.shortcut}</span>}</button>)}
    </div>}
  </div>;
}

```

### NavTabs.d.ts

```ts
export interface NavTabItem { id: string; label: string; icon?: string; count?: number }
export interface NavTabsProps { tabs: Array<string | NavTabItem>; value: string; onChange?: (id: string) => void; style?: React.CSSProperties }
export function NavTabs(props: NavTabsProps): JSX.Element;

```

## components/navigation/NavTabs.jsx

```jsx
import React from 'react';
import { useStyle } from '../lib/styles.js';
import { Icon } from '../display/Icon.jsx';
const CSS = `.mana-tab{display:flex;align-items:center;gap:6px;padding:8px 2px;margin:0 12px -1px 0;border:0;border-bottom:2px solid transparent;background:transparent;font:var(--type-body);color:var(--text-secondary);cursor:pointer;transition:color var(--dur) var(--ease),border-color var(--dur) var(--ease);white-space:nowrap}.mana-tab:hover{color:var(--text-body)}.mana-tab[aria-selected=true]{color:var(--text-body);font-weight:500;border-bottom-color:var(--ink)}`;
export function NavTabs({ tabs = [], value, onChange, style }) {
  useStyle('mana-tabs-css', CSS);
  return <div role="tablist" style={{ display: 'flex', borderBottom: '1px solid var(--border)', overflowX: 'auto', ...style }}>
    {tabs.map(t => { const o = typeof t === 'string' ? { id: t, label: t } : t; return <button key={o.id} type="button" role="tab" tabIndex={-1} aria-selected={o.id === value} className="mana-tab" onClick={() => onChange && onChange(o.id)}>{o.icon && <Icon name={o.icon} size={14} />}{o.label}{o.count != null && <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{o.count}</span>}</button>; })}
  </div>;
}

```

### PageHeader.d.ts

```ts
export interface PageHeaderProps { title: string; subtitle?: string; actions?: React.ReactNode; breadcrumb?: React.ReactNode; style?: React.CSSProperties }
export function PageHeader(props: PageHeaderProps): JSX.Element;

```

## components/navigation/PageHeader.jsx

```jsx
import React from 'react';
export function PageHeader({ title, subtitle, actions, breadcrumb, style }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, ...style }}>
    <div style={{ minWidth: 0 }}>{breadcrumb && <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)', marginBottom: 2, display: 'flex', gap: 6 }}>{breadcrumb}</div>}<h2 style={{ margin: 0, font: 'var(--type-page-title)', letterSpacing: 'var(--tracking-tight)', color: 'var(--text-body)' }}>{title}</h2>{subtitle && <p style={{ margin: '2px 0 0', font: 'var(--type-body)', color: 'var(--text-secondary)' }}>{subtitle}</p>}</div>
    {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>{actions}</div>}
  </div>;
}

```

### SettingsNav.d.ts

```ts
export interface SettingsNavItem { id: string; label: string; icon?: string; readOnly?: boolean }
export interface SettingsNavGroup { label: string; items: SettingsNavItem[] }
export interface SettingsNavProps { groups: SettingsNavGroup[]; active?: string; onNavigate?: (id: string) => void; style?: React.CSSProperties }
export function SettingsNav(props: SettingsNavProps): JSX.Element;

```

## components/navigation/SettingsNav.jsx

```jsx
import React from 'react';
import { useStyle } from '../lib/styles.js';
import { Icon } from '../display/Icon.jsx';
const CSS = `.mana-snav-link{display:flex;align-items:center;gap:8px;border-radius:var(--radius-md);padding:5px 8px;font:var(--type-body);color:var(--text-secondary);text-decoration:none;cursor:pointer;transition:background var(--dur-fast) var(--ease)}.mana-snav-link:hover{background:var(--bg-secondary);color:var(--text-body);text-decoration:none}.mana-snav-link[aria-current=page]{background:var(--bg-secondary);color:var(--text-body);font-weight:500}`;
export function SettingsNav({ groups = [], active, onNavigate, style }) {
  useStyle('mana-snav-css', CSS);
  return <nav aria-label="Sections des paramètres" style={{ width: 'var(--settings-nav-w)', flexShrink: 0, ...style }}>
    {groups.map(g => <div key={g.label} role="group" style={{ marginBottom: 12 }}><p style={{ margin: '0 0 2px', padding: '0 8px', font: 'var(--type-overline)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', color: 'var(--text-muted)' }}>{g.label}</p>{g.items.map(s => <a key={s.id} href="#" className="mana-snav-link" aria-current={s.id === active ? 'page' : undefined} onClick={e => { e.preventDefault(); onNavigate && onNavigate(s.id); }}>{s.icon && <Icon name={s.icon} size={14} style={{ color: 'var(--text-muted)' }} />}{s.label}{s.readOnly && <Icon name="lock" size={12} style={{ marginLeft: 'auto', color: 'var(--text-muted)' }} />}</a>)}</div>)}
  </nav>;
}

```

### SidebarNav.d.ts

```ts
export interface SidebarItem { id?: string; label?: string; icon?: string; href?: string; badge?: number | string; /** render a small uppercase group label instead of a link */ section?: string }
export interface SidebarNavProps { items: SidebarItem[]; active?: string; onNavigate?: (id: string) => void; user?: string; roleLabel?: string; onSignOut?: () => void; collapsed?: boolean; logoSrc?: string; orgName?: string; /** extra slot above the user row */ footer?: React.ReactNode; style?: React.CSSProperties }
export function SidebarNav(props: SidebarNavProps): JSX.Element;

```

## components/navigation/SidebarNav.jsx

```jsx
import React from 'react';
import { useStyle } from '../lib/styles.js';
import { Icon } from '../display/Icon.jsx';
import { Avatar } from '../display/Avatar.jsx';
const CSS = `.mana-nav-link{display:flex;align-items:center;gap:10px;border-radius:var(--radius-nav);padding:6px 8px;font:var(--type-body);color:var(--text-secondary);text-decoration:none;cursor:pointer;border:0;background:transparent;width:100%;box-sizing:border-box;text-align:left;transition:background var(--dur-fast) var(--ease),color var(--dur-fast) var(--ease)}.mana-nav-link:hover{background:rgba(31,31,32,.05);color:var(--text-body);text-decoration:none}.mana-nav-link[aria-current=page]{background:var(--surface-card);color:var(--text-body);font-weight:500;box-shadow:0 0 0 1px var(--border)}.mana-nav-link .mana-nav-ico{color:var(--text-muted);display:flex}.mana-nav-link[aria-current=page] .mana-nav-ico{color:var(--text-body)}.mana-nav-sect{padding:12px 8px 4px;font:var(--type-overline);text-transform:uppercase;letter-spacing:var(--tracking-wide);color:var(--text-muted)}`;
export function SidebarNav({ items = [], active, onNavigate, user, roleLabel, onSignOut, collapsed, logoSrc, orgName = 'Clinique MANA', footer, style }) {
  useStyle('mana-nav-css', CSS);
  const w = collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)';
  return <aside style={{ display: 'flex', flexDirection: 'column', width: w, minWidth: w, height: '100%', background: 'var(--surface-sidebar)', boxSizing: 'border-box', transition: 'width var(--dur) var(--ease)', padding: '0 8px', ...style }}>
    <div style={{ height: 'var(--topbar-h)', display: 'flex', alignItems: 'center', padding: '0 8px', flexShrink: 0 }}>{logoSrc ? <img src={logoSrc} alt={orgName} style={{ height: 22, maxWidth: collapsed ? 32 : 120, objectFit: 'contain', objectPosition: 'left' }} /> : <span style={{ font: 'var(--type-label)', color: 'var(--text-body)' }}>{collapsed ? 'M' : orgName}</span>}</div>
    <nav aria-label="Menu principal" style={{ flex: 1, overflowY: 'auto', paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {items.map((it, i) => it.section ? (!collapsed && <div key={'s' + i} className="mana-nav-sect">{it.section}</div>) : <a key={it.id} href={it.href || '#'} className="mana-nav-link" aria-current={it.id === active ? 'page' : undefined} title={collapsed ? it.label : undefined} onClick={e => { e.preventDefault(); onNavigate && onNavigate(it.id); }} style={collapsed ? { justifyContent: 'center', padding: 8 } : null}><span className="mana-nav-ico"><Icon name={it.icon} size={16} /></span>{!collapsed && <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>}{!collapsed && it.badge != null && <span style={{ font: 'var(--type-caption)', fontWeight: 500, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{it.badge}</span>}</a>)}
    </nav>
    <div style={{ padding: '8px 0 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {footer}
      {user && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', justifyContent: collapsed ? 'center' : 'flex-start' }}><Avatar name={user} size="sm" tone="neutral" />{!collapsed && <div style={{ minWidth: 0, flex: 1 }}><p style={{ margin: 0, font: 'var(--type-label)', color: 'var(--text-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user}</p>{roleLabel && <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{roleLabel}</p>}</div>}{!collapsed && onSignOut && <button type="button" className="mana-nav-link" aria-label="Se déconnecter" title="Se déconnecter" onClick={onSignOut} style={{ width: 'auto', padding: 4 }}><span className="mana-nav-ico"><Icon name="log-out" size={14} /></span></button>}</div>}
    </div>
  </aside>;
}

```

### Topbar.d.ts

```ts
export interface TopbarProps { title: string; /** parent labels shown before the title: ["Professionnels"] */ crumbs?: string[]; onSearch?: () => void; notifications?: number; user?: string; actions?: React.ReactNode; onToggleSidebar?: () => void; style?: React.CSSProperties }
export function Topbar(props: TopbarProps): JSX.Element;

```

## components/navigation/Topbar.jsx

```jsx
import React from 'react';
import { useStyle } from '../lib/styles.js';
import { Icon } from '../display/Icon.jsx';
import { Avatar } from '../display/Avatar.jsx';
const CSS = `.mana-topbar-ico{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:var(--radius-md);border:0;background:transparent;color:var(--text-secondary);cursor:pointer;position:relative;transition:background var(--dur-fast) var(--ease)}.mana-topbar-ico:hover{background:var(--bg-secondary);color:var(--text-body)}.mana-topbar-search{display:flex;align-items:center;gap:8px;height:28px;padding:0 6px 0 8px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface-card);color:var(--text-muted);font:var(--type-body);cursor:text;min-width:200px;transition:border-color var(--dur) var(--ease)}.mana-topbar-search:hover{border-color:var(--border-strong)}`;
export function Topbar({ title, crumbs, onSearch, notifications, user, actions, onToggleSidebar, style }) {
  useStyle('mana-topbar-css', CSS);
  return <header style={{ height: 'var(--topbar-h)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '0 var(--page-pad)', borderBottom: '1px solid var(--border)', background: 'var(--bg)', boxSizing: 'border-box', flexShrink: 0, ...style }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1, font: 'var(--type-label)', color: 'var(--text-body)' }}>{onToggleSidebar && <button type="button" className="mana-topbar-ico" aria-label="Réduire le menu" onClick={onToggleSidebar}><Icon name="panel-left" size={16} /></button>}{crumbs && crumbs.map((c, i) => <React.Fragment key={i}><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{c}</span><span style={{ color: 'var(--text-muted)' }}>/</span></React.Fragment>)}<span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span></div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      {actions}
      {onSearch && <button type="button" className="mana-topbar-search" onClick={onSearch}><Icon name="search" size={14} /><span style={{ flex: 1, textAlign: 'left' }}>Rechercher…</span><kbd style={{ font: 'var(--type-overline)', fontFamily: 'var(--font-sans)', background: 'var(--bg-secondary)', borderRadius: 4, padding: '1px 4px', color: 'var(--text-secondary)' }}>⌘K</kbd></button>}
      <button type="button" className="mana-topbar-ico" aria-label="Notifications"><Icon name="bell" size={16} />{notifications > 0 && <span style={{ position: 'absolute', top: 5, right: 6, width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', border: '2px solid var(--bg)' }} />}</button>
      <button type="button" className="mana-topbar-ico" aria-label="Aide"><Icon name="circle-help" size={16} /></button>
      {user && <Avatar name={user} size="sm" tone="neutral" />}
    </div>
  </header>;
}

```

### AlertDialog.d.ts

```ts
export interface AlertDialogProps { open?: boolean; title: string; description?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean; onConfirm?: () => void; onCancel?: () => void; inline?: boolean; busy?: boolean }
export function AlertDialog(props: AlertDialogProps): JSX.Element | null;

```

## components/overlays/AlertDialog.jsx

```jsx
import React from 'react';
import { Dialog } from './Dialog.jsx';
import { Button } from '../forms/Button.jsx';
export function AlertDialog({ open = true, title, description, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', destructive, onConfirm, onCancel, inline, busy }) {
  return <Dialog open={open} inline={inline} hideClose title={title} description={description} onClose={onCancel} footer={<><Button variant="outline" onClick={onCancel} disabled={busy}>{cancelLabel}</Button><Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm} disabled={busy}>{confirmLabel}</Button></>} />;
}

```

### Dialog.d.ts

```ts
export interface DialogProps { open?: boolean; onClose?: () => void; title?: string; description?: string; footer?: React.ReactNode; hideClose?: boolean; maxWidth?: number; /** render the panel without the fixed overlay (for previews/cards) */ inline?: boolean; children?: React.ReactNode; style?: React.CSSProperties }
export function Dialog(props: DialogProps): JSX.Element | null;

```

## components/overlays/Dialog.jsx

```jsx
import React from 'react';
import { useStyle } from '../lib/styles.js';
import { Icon } from '../display/Icon.jsx';
const CSS = `.mana-dialog-close{position:absolute;right:16px;top:16px;display:flex;border:0;background:transparent;border-radius:var(--radius-lg);padding:4px;opacity:.7;cursor:pointer;color:var(--text-body);transition:opacity var(--dur) var(--ease)}.mana-dialog-close:hover{opacity:1}.mana-dialog-close:focus-visible{outline:none;box-shadow:var(--ring)}`;
export function Dialog({ open = true, onClose, title, description, footer, hideClose, maxWidth = 512, inline, children, style }) {
  useStyle('mana-dialog-css', CSS);
  React.useEffect(() => { if (!open || inline) return; const h = e => { if (e.key === 'Escape' && onClose) onClose(); }; document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h); }, [open, inline, onClose]);
  if (!open) return null;
  const panel = <div role="dialog" aria-modal={!inline} aria-labelledby={title ? 'mana-dialog-title' : undefined} style={{ position: 'relative', width: '100%', maxWidth, boxSizing: 'border-box', display: 'grid', gap: 14, borderRadius: 'var(--radius-dialog)', background: 'var(--surface-card)', padding: 20, boxShadow: 'var(--shadow-large)', animation: inline ? undefined : 'mana-zoom-in var(--dur) var(--ease-out)', ...style }}>
    {(title || description) && <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingRight: hideClose ? 0 : 24 }}>{title && <h2 id="mana-dialog-title" style={{ margin: 0, font: 'var(--type-section-title)', color: 'var(--text-body)' }}>{title}</h2>}{description && <p style={{ margin: 0, font: 'var(--type-body)', color: 'var(--text-secondary)' }}>{description}</p>}</div>}
    {children}
    {footer && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{footer}</div>}
    {!hideClose && <button type="button" tabIndex={-1} className="mana-dialog-close" aria-label="Fermer" onClick={onClose}><Icon name="x" /></button>}
  </div>;
  if (inline) return panel;
  return <div onMouseDown={e => { if (e.target === e.currentTarget && onClose) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'var(--surface-overlay)', backdropFilter: 'blur(var(--blur-overlay))', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, animation: 'mana-fade-in var(--dur) var(--ease-out)' }}>{panel}</div>;
}

```

### Popover.d.ts

```ts
export interface PopoverProps { trigger: React.ReactNode; children: React.ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void; align?: 'start' | 'end'; width?: number; style?: React.CSSProperties }
export function Popover(props: PopoverProps): JSX.Element;

```

## components/overlays/Popover.jsx

```jsx
import React from 'react';
export function Popover({ trigger, children, open: openProp, onOpenChange, align = 'start', width = 288, style }) {
  const [openState, setOpen] = React.useState(false);
  const open = openProp ?? openState;
  const set = v => { setOpen(v); onOpenChange && onOpenChange(v); };
  const ref = React.useRef(null);
  React.useEffect(() => { if (!open) return; const h = e => { if (ref.current && !ref.current.contains(e.target)) set(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  return <div ref={ref} style={{ position: 'relative', display: 'inline-flex', ...style }}>
    <span onClick={() => set(!open)} style={{ display: 'inline-flex' }}>{trigger}</span>
    {open && <div style={{ position: 'absolute', top: '100%', [align === 'end' ? 'right' : 'left']: 0, marginTop: 4, zIndex: 50, width, boxSizing: 'border-box', borderRadius: 'var(--radius-menu)', border: '1px solid var(--border)', background: 'var(--surface-card)', padding: 16, boxShadow: 'var(--shadow-medium)', animation: 'mana-zoom-in var(--dur-fast) var(--ease-out)' }}>{children}</div>}
  </div>;
}

```

### Sheet.d.ts

```ts
export interface SheetProps { open?: boolean; onClose?: () => void; title?: string; description?: string; /** replaces the default header */ header?: React.ReactNode; footer?: React.ReactNode; side?: 'right' | 'left' | 'top' | 'bottom'; width?: number; inline?: boolean; children?: React.ReactNode; style?: React.CSSProperties }
export function Sheet(props: SheetProps): JSX.Element | null;

```

## components/overlays/Sheet.jsx

```jsx
import React from 'react';
import { useStyle } from '../lib/styles.js';
import { Icon } from '../display/Icon.jsx';
const CSS = `.mana-sheet-close{display:flex;border:0;background:transparent;border-radius:var(--radius-lg);padding:4px;opacity:.7;cursor:pointer;color:var(--text-body)}.mana-sheet-close:hover{opacity:1}`;
export function Sheet({ open = true, onClose, title, description, header, footer, side = 'right', width = 480, inline, children, style }) {
  useStyle('mana-sheet-css', CSS);
  if (!open) return null;
  const vertical = side === 'top' || side === 'bottom';
  const panel = <div role="dialog" aria-modal={!inline} style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface-card)', boxShadow: 'var(--shadow-large)', boxSizing: 'border-box', ...(inline ? { width: vertical ? '100%' : width, height: '100%', borderLeft: '1px solid var(--border)' } : { position: 'fixed', zIndex: 50, [side]: 0, ...(vertical ? { left: 0, right: 0, maxHeight: '80vh' } : { top: 0, bottom: 0, width, maxWidth: '100vw' }), [vertical ? (side === 'top' ? 'borderBottom' : 'borderTop') : (side === 'right' ? 'borderLeft' : 'borderRight')]: '1px solid var(--border)', animation: side === 'right' ? 'mana-slide-in-right var(--dur-slow) var(--ease-out)' : 'mana-fade-in var(--dur-slow) var(--ease-out)' }), ...style }}>
    {header || <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '16px 20px 12px' }}><div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>{title && <h2 style={{ margin: 0, font: 'var(--type-section-title)', color: 'var(--text-body)' }}>{title}</h2>}{description && <p style={{ margin: 0, font: 'var(--type-body)', color: 'var(--text-secondary)' }}>{description}</p>}</div><button type="button" tabIndex={-1} className="mana-sheet-close" aria-label="Fermer" onClick={onClose}><Icon name="x" /></button></div>}
    <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px' }}>{children}</div>
    {footer && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 12, borderTop: '1px solid var(--border)' }}>{footer}</div>}
  </div>;
  if (inline) return panel;
  return <div onMouseDown={e => { if (e.target === e.currentTarget && onClose) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'var(--surface-overlay)', backdropFilter: 'blur(var(--blur-overlay))', animation: 'mana-fade-in var(--dur) var(--ease-out)' }}>{panel}</div>;
}

```

### Toast.d.ts

```ts
export interface ToastProps { variant?: 'default' | 'success' | 'error' | 'warning'; title: string; description?: string; action?: React.ReactNode; onDismiss?: () => void; style?: React.CSSProperties }
export function Toast(props: ToastProps): JSX.Element;

```

## components/overlays/Toast.jsx

```jsx
import React from 'react';
import { Icon } from '../display/Icon.jsx';
import { useStyle } from '../lib/styles.js';
const CSS = `.mana-toast-x{display:flex;border:0;background:transparent;padding:2px;border-radius:4px;cursor:pointer;color:rgba(255,255,255,.6)}.mana-toast-x:hover{color:#fff}`;
const V = { default: ['info', 'rgba(255,255,255,.7)'], success: ['circle-check', 'var(--teal-300)'], error: ['circle-alert', '#F7A3BB'], warning: ['triangle-alert', 'var(--yellow-300)'] };
export function Toast({ variant = 'default', title, description, action, onDismiss, style }) {
  useStyle('mana-toast-css', CSS);
  const [icon, color] = V[variant] || V.default;
  return <div role="status" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, width: 356, maxWidth: '100%', boxSizing: 'border-box', borderRadius: 'var(--radius-card)', background: 'var(--ink)', color: '#fff', padding: '10px 12px', boxShadow: 'var(--shadow-large)', animation: 'mana-zoom-in var(--dur) var(--ease-out)', ...style }}>
    <span style={{ display: 'flex', color, marginTop: 1 }}><Icon name={icon} /></span>
    <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, font: 'var(--type-label)', color: '#fff' }}>{title}</p>{description && <p style={{ margin: '2px 0 0', font: 'var(--type-body)', color: 'rgba(255,255,255,.7)' }}>{description}</p>}{action && <div style={{ marginTop: 8 }}>{action}</div>}</div>
    {onDismiss && <button type="button" className="mana-toast-x" aria-label="Fermer" onClick={onDismiss}><Icon name="x" size={14} /></button>}
  </div>;
}

```
