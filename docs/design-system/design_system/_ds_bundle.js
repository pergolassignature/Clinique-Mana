/* @ds-bundle: {"format":4,"namespace":"CliniqueMANADesignSystem_d475f9","components":[{"name":"Alert","sourcePath":"components/display/Alert.jsx"},{"name":"Avatar","sourcePath":"components/display/Avatar.jsx"},{"name":"Badge","sourcePath":"components/display/Badge.jsx"},{"name":"Card","sourcePath":"components/display/Card.jsx"},{"name":"EmptyState","sourcePath":"components/display/EmptyState.jsx"},{"name":"Icon","sourcePath":"components/display/Icon.jsx"},{"name":"Skeleton","sourcePath":"components/display/Skeleton.jsx"},{"name":"StarToggle","sourcePath":"components/display/StarToggle.jsx"},{"name":"StatusIndicator","sourcePath":"components/display/StatusIndicator.jsx"},{"name":"Tooltip","sourcePath":"components/display/Tooltip.jsx"},{"name":"Button","sourcePath":"components/forms/Button.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Label","sourcePath":"components/forms/Label.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"},{"name":"AuthCard","sourcePath":"components/layout/AuthCard.jsx"},{"name":"FullPageMessage","sourcePath":"components/layout/FullPageMessage.jsx"},{"name":"Accordion","sourcePath":"components/navigation/Accordion.jsx"},{"name":"CommandPalette","sourcePath":"components/navigation/CommandPalette.jsx"},{"name":"DropdownMenu","sourcePath":"components/navigation/DropdownMenu.jsx"},{"name":"NavTabs","sourcePath":"components/navigation/NavTabs.jsx"},{"name":"PageHeader","sourcePath":"components/navigation/PageHeader.jsx"},{"name":"SettingsNav","sourcePath":"components/navigation/SettingsNav.jsx"},{"name":"SidebarNav","sourcePath":"components/navigation/SidebarNav.jsx"},{"name":"Topbar","sourcePath":"components/navigation/Topbar.jsx"},{"name":"AlertDialog","sourcePath":"components/overlays/AlertDialog.jsx"},{"name":"Dialog","sourcePath":"components/overlays/Dialog.jsx"},{"name":"Popover","sourcePath":"components/overlays/Popover.jsx"},{"name":"Sheet","sourcePath":"components/overlays/Sheet.jsx"},{"name":"Toast","sourcePath":"components/overlays/Toast.jsx"}],"sourceHashes":{"components/display/Alert.jsx":"2869fa0ff5c2","components/display/Avatar.jsx":"ac79ae5b9056","components/display/Badge.jsx":"c1e5da9c2f10","components/display/Card.jsx":"1ac400985be1","components/display/EmptyState.jsx":"1f5c6232c5de","components/display/Icon.jsx":"814467de4a51","components/display/Skeleton.jsx":"fa59d686f2b2","components/display/StarToggle.jsx":"1193decc8060","components/display/StatusIndicator.jsx":"c10a89f3fb77","components/display/Tooltip.jsx":"0716a78fbc1b","components/forms/Button.jsx":"ad559a1a9bec","components/forms/Checkbox.jsx":"0da1d32dd7a8","components/forms/Input.jsx":"35dfd23a0aa7","components/forms/Label.jsx":"d2d9f7a3f964","components/forms/Select.jsx":"a0d90cd7a046","components/forms/Switch.jsx":"4f3e28f6b625","components/forms/Textarea.jsx":"9fcfbed1427a","components/layout/AuthCard.jsx":"ca81cac50921","components/layout/FullPageMessage.jsx":"0d0611de3d3f","components/lib/styles.js":"c9cfb3edf4d9","components/navigation/Accordion.jsx":"413206edd123","components/navigation/CommandPalette.jsx":"d338be5447dd","components/navigation/DropdownMenu.jsx":"e6ca084bf670","components/navigation/NavTabs.jsx":"6303520488e0","components/navigation/PageHeader.jsx":"7408c71e37d1","components/navigation/SettingsNav.jsx":"3585da707938","components/navigation/SidebarNav.jsx":"2770bee1de2e","components/navigation/Topbar.jsx":"b7b317352f00","components/overlays/AlertDialog.jsx":"c08546b8a5c2","components/overlays/Dialog.jsx":"44b2213b6fe0","components/overlays/Popover.jsx":"e79166a5dcd0","components/overlays/Sheet.jsx":"04970276f507","components/overlays/Toast.jsx":"764d98843c40","ui_kits/clinique-mana-app/Accueil.jsx":"7007f86b0128","ui_kits/clinique-mana-app/App.jsx":"81a9ccd03032","ui_kits/clinique-mana-app/Demandes.jsx":"7c78ad736cef","ui_kits/clinique-mana-app/Login.jsx":"04e955578f54","ui_kits/clinique-mana-app/Parametres.jsx":"f0c7552a7ae6","ui_kits/clinique-mana-app/Professionnels.jsx":"2acde7c13c0d","ui_kits/clinique-mana-app/Shell.jsx":"e578fd8b4b51","ui_kits/clinique-mana-app/data.jsx":"390155889a3c"},"inlinedExternals":[],"unexposedExports":[{"name":"iconCdn","sourcePath":"components/lib/styles.js"},{"name":"useStyle","sourcePath":"components/lib/styles.js"}]} */

(() => {

const __ds_ns = (window.CliniqueMANADesignSystem_d475f9 = window.CliniqueMANADesignSystem_d475f9 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/display/Avatar.jsx
try { (() => {
const S = {
  sm: 'var(--avatar-sm)',
  md: 'var(--avatar)',
  lg: 'var(--avatar-lg)'
};
const initialsOf = n => (n || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
function Avatar({
  name,
  src,
  size = 'md',
  tone = 'soft',
  style
}) {
  const d = S[size] || S.md;
  const base = {
    width: d,
    height: d,
    borderRadius: '50%',
    overflow: 'hidden',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    font: 'var(--type-label)',
    fontSize: size === 'lg' ? 16 : size === 'sm' ? 10 : 12,
    ...style
  };
  if (src) return /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name || '',
    style: {
      ...base,
      objectFit: 'cover'
    }
  });
  const tones = {
    soft: ['var(--bg-secondary)', 'var(--gray-700)'],
    mint: ['var(--bg-secondary)', 'var(--gray-700)'],
    neutral: ['var(--bg-secondary)', 'var(--text-secondary)']
  };
  const [bg, fg] = tones[tone] || tones.soft;
  return /*#__PURE__*/React.createElement("span", {
    "aria-label": name,
    style: {
      ...base,
      background: bg,
      color: fg,
      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.06)',
      fontWeight: 500
    }
  }, initialsOf(name));
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/display/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const DOT = {
  default: 'var(--text-secondary)',
  secondary: 'var(--neutral-dot)',
  outline: 'var(--neutral-dot)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--danger)',
  info: 'var(--teal-500)'
};
/** Status as text: a 6px dot and a word. No pill, no fill. `filled` = the one exception (e.g. Urgent). */
function Badge({
  variant = 'default',
  dot = true,
  filled,
  children,
  style,
  ...rest
}) {
  const color = DOT[variant] || DOT.default;
  const fill = filled ? {
    background: variant === 'error' ? 'var(--danger)' : 'var(--ink)',
    color: '#fff',
    padding: '0 5px',
    borderRadius: 'var(--radius-badge)',
    fontSize: 11,
    lineHeight: '16px',
    letterSpacing: '.02em',
    fontWeight: 600
  } : null;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      font: 'var(--type-caption)',
      fontWeight: 500,
      color: 'var(--text-secondary)',
      whiteSpace: 'nowrap',
      lineHeight: '16px',
      ...fill,
      ...style
    }
  }, rest), dot && !filled && /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: color,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, children));
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Badge.jsx", error: String((e && e.message) || e) }); }

// components/display/EmptyState.jsx
try { (() => {
/** Plain text, no box, no icon. Says what to do next in one sentence. */
function EmptyState({
  title,
  description,
  action,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      padding: '24px 0',
      ...style
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      font: 'var(--type-body)',
      fontWeight: 500,
      color: 'var(--text-body)'
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      maxWidth: 420,
      font: 'var(--type-body)',
      color: 'var(--text-muted)'
    }
  }, description), action && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, action));
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/display/Skeleton.jsx
try { (() => {
function Skeleton({
  width = '100%',
  height = 16,
  radius = 'var(--radius-md)',
  shimmer,
  style
}) {
  const base = shimmer ? {
    background: 'linear-gradient(90deg,var(--bg-secondary) 0%,var(--bg) 50%,var(--bg-secondary) 100%)',
    backgroundSize: '200% 100%',
    animation: 'mana-shimmer 2s linear infinite'
  } : {
    background: 'rgba(142,142,146,.2)',
    animation: 'mana-pulse 2s cubic-bezier(.4,0,.6,1) infinite'
  };
  return /*#__PURE__*/React.createElement("div", {
    "aria-hidden": "true",
    style: {
      width,
      height,
      borderRadius: radius,
      ...base,
      ...style
    }
  });
}
Object.assign(__ds_scope, { Skeleton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Skeleton.jsx", error: String((e && e.message) || e) }); }

// components/display/Tooltip.jsx
try { (() => {
function Tooltip({
  content,
  side = 'top',
  open,
  children
}) {
  const [hover, setHover] = React.useState(false);
  const show = open ?? hover;
  const pos = {
    top: {
      bottom: '100%',
      left: '50%',
      transform: 'translate(-50%,-4px)'
    },
    bottom: {
      top: '100%',
      left: '50%',
      transform: 'translate(-50%,4px)'
    },
    right: {
      left: '100%',
      top: '50%',
      transform: 'translate(4px,-50%)'
    },
    left: {
      right: '100%',
      top: '50%',
      transform: 'translate(-4px,-50%)'
    }
  }[side];
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex'
    },
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onFocus: () => setHover(true),
    onBlur: () => setHover(false)
  }, children, show && /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    style: {
      position: 'absolute',
      zIndex: 50,
      whiteSpace: 'nowrap',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--gray-900)',
      color: '#fff',
      padding: '3px 7px',
      font: 'var(--type-caption)',
      boxShadow: 'var(--shadow-medium)',
      animation: 'mana-zoom-in var(--dur-fast) var(--ease-out)',
      pointerEvents: 'none',
      ...pos
    }
  }, content));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/display/StarToggle.jsx
try { (() => {
function StarToggle({
  isSpecialized,
  onToggle,
  disabled,
  size = 'sm'
}) {
  const px = size === 'md' ? 16 : 14;
  const label = isSpecialized ? 'Retirer la spécialisation' : 'Marquer comme spécialisé';
  return /*#__PURE__*/React.createElement(__ds_scope.Tooltip, {
    content: label
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": label,
    "aria-pressed": !!isSpecialized,
    disabled: disabled,
    onClick: e => {
      e.stopPropagation();
      if (!disabled && onToggle) onToggle();
    },
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: 0,
      background: 'transparent',
      padding: 2,
      borderRadius: 4,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .5 : 1,
      color: isSpecialized ? 'var(--warning)' : 'var(--gray-400)'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: px,
    height: px,
    viewBox: "0 0 24 24",
    fill: isSpecialized ? 'currentColor' : 'none',
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("polygon", {
    points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
  }))));
}
Object.assign(__ds_scope, { StarToggle });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/StarToggle.jsx", error: String((e && e.message) || e) }); }

// components/forms/Label.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Label({
  children,
  required,
  hint,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", _extends({
    style: {
      display: 'block',
      font: 'var(--type-label)',
      color: 'var(--text-body)',
      ...style
    }
  }, rest), children, required && /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      color: 'var(--primary)',
      marginLeft: 2
    }
  }, "*"), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 6,
      font: 'var(--type-caption)',
      color: 'var(--text-muted)',
      fontWeight: 400
    }
  }, hint));
}
Object.assign(__ds_scope, { Label });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Label.jsx", error: String((e && e.message) || e) }); }

// components/layout/AuthCard.jsx
try { (() => {
function AuthCard({
  title,
  subtitle,
  status,
  statusMuted,
  appName = 'Clinique MANA',
  logoSrc,
  fill = true,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("main", {
    style: {
      display: 'flex',
      minHeight: fill ? '100vh' : undefined,
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      padding: '48px 16px',
      boxSizing: 'border-box',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      maxWidth: 360,
      boxSizing: 'border-box',
      borderRadius: 'var(--radius-card)',
      background: 'var(--surface-card)',
      border: '1px solid var(--border)',
      padding: 28
    }
  }, logoSrc ? /*#__PURE__*/React.createElement("img", {
    src: logoSrc,
    alt: appName,
    style: {
      height: 26,
      marginBottom: 20,
      display: 'block'
    }
  }) : /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 16px',
      font: 'var(--type-label)',
      color: 'var(--text-muted)'
    }
  }, appName), /*#__PURE__*/React.createElement("h1", {
    tabIndex: -1,
    style: {
      margin: 0,
      font: 'var(--type-section-title)',
      color: 'var(--text-body)',
      outline: 'none'
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      font: 'var(--type-body)',
      color: 'var(--text-secondary)'
    }
  }, subtitle), /*#__PURE__*/React.createElement("div", {
    role: "status",
    "aria-live": "polite"
  }, status && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '16px 0 0',
      font: 'var(--type-body)',
      ...(statusMuted ? {
        color: 'var(--text-muted)'
      } : {
        borderRadius: 'var(--radius-md)',
        background: 'var(--surface-card)',
        border: '1px solid var(--border)',
        padding: '8px 10px',
        color: 'var(--text-body)'
      })
    }
  }, status)), children && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 20
    }
  }, children)));
}
Object.assign(__ds_scope, { AuthCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/AuthCard.jsx", error: String((e && e.message) || e) }); }

// components/layout/FullPageMessage.jsx
try { (() => {
function FullPageMessage({
  title,
  body,
  action,
  role,
  compact,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    role: role,
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: compact ? '48px 16px' : '0 16px',
      minHeight: compact ? undefined : '60vh',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 384,
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: compact ? 'var(--type-card-title)' : 'var(--type-section-title)',
      color: 'var(--text-body)'
    }
  }, title), body && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0 0',
      font: 'var(--type-body)',
      color: 'var(--text-muted)'
    }
  }, body), action && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 24
    }
  }, action)));
}
Object.assign(__ds_scope, { FullPageMessage });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/FullPageMessage.jsx", error: String((e && e.message) || e) }); }

// components/lib/styles.js
try { (() => {
// Injects a component's hover/focus CSS once per document. Components keep layout inline and use this only for pseudo-states.
function useStyle(id, css) {
  if (typeof document === 'undefined') return;
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = css;
  document.head.appendChild(s);
}
const iconCdn = 'https://unpkg.com/lucide-static@0.460.0/icons/';
Object.assign(__ds_scope, { useStyle, iconCdn });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/lib/styles.js", error: String((e && e.message) || e) }); }

// components/display/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `.mana-card{border-radius:var(--radius-card);background:var(--surface-card);box-sizing:border-box;border:1px solid var(--border)}.mana-card-plain{border-color:transparent;background:transparent}.mana-card.is-interactive{cursor:pointer;text-align:left;transition:background var(--dur) var(--ease),border-color var(--dur) var(--ease)}.mana-card.is-interactive:hover{background:var(--surface-panel-hover);border-color:var(--border-strong)}.mana-card.is-interactive:focus-visible{outline:none;box-shadow:var(--ring)}`;
function Card({
  title,
  description,
  action,
  footer,
  variant = 'outline',
  padding = 'var(--card-pad)',
  interactive,
  as,
  style,
  children,
  ...rest
}) {
  __ds_scope.useStyle('mana-card-css', CSS);
  const Tag = as || (interactive ? 'button' : 'div');
  const hasHeader = title || description || action;
  return /*#__PURE__*/React.createElement(Tag, _extends({
    className: `mana-card mana-card-${variant} ${interactive ? 'is-interactive' : ''}`,
    style: {
      padding,
      display: 'flex',
      flexDirection: 'column',
      width: Tag === 'button' ? '100%' : undefined,
      font: 'inherit',
      color: 'inherit',
      ...style
    }
  }, rest), hasHeader && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: children ? 12 : 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      minWidth: 0
    }
  }, title && /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      font: 'var(--type-card-title)',
      letterSpacing: 'var(--tracking-tight)',
      color: 'var(--text-body)'
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-caption)',
      color: 'var(--text-muted)'
    }
  }, description)), action), children, footer && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginTop: 12
    }
  }, footer));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Card.jsx", error: String((e && e.message) || e) }); }

// components/display/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const pascal = n => n.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
// lucide UMD icon nodes come either as [[tag, attrs], …] (new) or ['svg', attrs, [[tag, attrs], …]] (old).
const childrenOf = node => {
  if (!Array.isArray(node)) return null;
  if (node.length && Array.isArray(node[0])) return node;
  if (node[0] === 'svg' && Array.isArray(node[2])) return node[2];
  return null;
};
/** Lucide icon. Renders inline SVG when the lucide UMD (window.lucide) is loaded, otherwise a currentColor mask from the CDN. name = kebab-case lucide name. */
function Icon({
  name,
  size = 16,
  strokeWidth = 2,
  style,
  className,
  title
}) {
  const lib = typeof window !== 'undefined' && window.lucide && window.lucide.icons;
  const kids = lib ? childrenOf(lib[pascal(name)]) : null;
  const a11y = title ? {
    role: 'img',
    'aria-label': title
  } : {
    'aria-hidden': true
  };
  if (kids) {
    return /*#__PURE__*/React.createElement("svg", _extends({}, a11y, {
      className: className,
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: strokeWidth,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: {
        flexShrink: 0,
        display: 'inline-block',
        verticalAlign: 'middle',
        ...style
      }
    }), kids.map((k, i) => Array.isArray(k) ? React.createElement(k[0], {
      key: i,
      ...(k[1] || {})
    }) : null));
  }
  const url = `url(${__ds_scope.iconCdn}${name}.svg)`;
  return /*#__PURE__*/React.createElement("span", _extends({}, a11y, {
    className: className,
    style: {
      display: 'inline-block',
      flexShrink: 0,
      width: size,
      height: size,
      backgroundColor: 'currentColor',
      WebkitMask: `${url} center / contain no-repeat`,
      mask: `${url} center / contain no-repeat`,
      ...style
    }
  }));
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Icon.jsx", error: String((e && e.message) || e) }); }

// components/display/Alert.jsx
try { (() => {
const V = {
  default: {
    color: 'var(--text-secondary)',
    icon: 'info'
  },
  destructive: {
    color: 'var(--danger)',
    icon: 'circle-alert'
  },
  warning: {
    color: 'var(--warning)',
    icon: 'triangle-alert'
  },
  success: {
    color: 'var(--success)',
    icon: 'circle-check'
  }
};
/** White, hairline border; the icon alone carries the tone. */
function Alert({
  variant = 'default',
  title,
  icon,
  children,
  action,
  style
}) {
  const v = V[variant] || V.default;
  return /*#__PURE__*/React.createElement("div", {
    role: "alert",
    style: {
      width: '100%',
      boxSizing: 'border-box',
      borderRadius: 'var(--radius-card)',
      border: '1px solid var(--border)',
      background: 'var(--surface-card)',
      padding: '10px 12px',
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      marginTop: 2,
      color: v.color
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon || v.icon,
    size: 15
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 1
    }
  }, title && /*#__PURE__*/React.createElement("h5", {
    style: {
      margin: 0,
      font: 'var(--type-label)',
      color: 'var(--text-body)'
    }
  }, title), children && /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body)',
      color: 'var(--text-secondary)'
    }
  }, children)), action);
}
Object.assign(__ds_scope, { Alert });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Alert.jsx", error: String((e && e.message) || e) }); }

// components/display/StatusIndicator.jsx
try { (() => {
const S = {
  complete: ['var(--success)', 'circle-check'],
  warning: ['var(--danger)', 'circle-alert'],
  pending: ['var(--warning)', 'clock']
};
function StatusIndicator({
  label,
  status = 'pending',
  description,
  style
}) {
  const [color, icon] = S[status] || S.pending;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
      padding: '6px 0',
      borderBottom: '1px solid var(--border-light)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      marginTop: 1,
      color,
      display: 'flex',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 14
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1,
      display: 'flex',
      alignItems: 'baseline',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-body)',
      color: 'var(--text-body)'
    }
  }, label), description && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-caption)',
      color: 'var(--text-muted)'
    }
  }, description)));
}
Object.assign(__ds_scope, { StatusIndicator });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/StatusIndicator.jsx", error: String((e && e.message) || e) }); }

// components/forms/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
const SIZES = {
  default: {
    height: 'var(--control-h)',
    padding: '0 var(--control-px)'
  },
  sm: {
    height: 'var(--control-h-sm)',
    padding: '0 var(--control-px-sm)',
    fontSize: 'var(--text-xs)'
  },
  lg: {
    height: 'var(--control-h-lg)',
    padding: '0 var(--control-px-lg)',
    fontSize: 'var(--text-base)'
  },
  icon: {
    height: 'var(--control-h)',
    width: 'var(--control-h)',
    padding: 0
  },
  'icon-sm': {
    height: 'var(--control-h-sm)',
    width: 'var(--control-h-sm)',
    padding: 0
  }
};
function Button({
  variant = 'default',
  size = 'default',
  fullWidth,
  as: Tag = 'button',
  style,
  className = '',
  children,
  ...rest
}) {
  __ds_scope.useStyle('mana-btn-css', CSS);
  const s = {
    ...(SIZES[size] || SIZES.default),
    ...(fullWidth ? {
      width: '100%'
    } : null),
    ...style
  };
  return /*#__PURE__*/React.createElement(Tag, _extends({
    type: Tag === 'button' ? rest.type || 'button' : undefined,
    className: `mana-btn mana-btn-${variant} ${className}`,
    style: s
  }, rest), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Button.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `.mana-cb{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font:var(--type-body);color:var(--text-body)}.mana-cb input{position:absolute;opacity:0;width:0;height:0}.mana-cb-box{width:16px;height:16px;border-radius:var(--radius-sm);border:1px solid var(--border-strong);background:var(--surface-card);display:flex;align-items:center;justify-content:center;color:#fff;transition:all var(--dur-fast) var(--ease)}.mana-cb input:checked+.mana-cb-box{background:var(--primary);border-color:var(--primary)}.mana-cb input:focus-visible+.mana-cb-box{box-shadow:var(--ring)}.mana-cb.is-disabled{cursor:not-allowed;opacity:.5}`;
function Checkbox({
  checked,
  defaultChecked,
  onChange,
  disabled,
  label,
  description,
  style,
  ...rest
}) {
  __ds_scope.useStyle('mana-cb-css', CSS);
  return /*#__PURE__*/React.createElement("label", {
    className: `mana-cb ${disabled ? 'is-disabled' : ''}`,
    style: {
      alignItems: description ? 'flex-start' : 'center',
      ...style
    }
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    checked: checked,
    defaultChecked: defaultChecked,
    onChange: onChange,
    disabled: disabled
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "mana-cb-box",
    style: description ? {
      marginTop: 2
    } : null
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "check",
    size: 12
  })), (label || description) && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: description ? 500 : 400
    }
  }, label), description && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-caption)',
      color: 'var(--text-muted)'
    }
  }, description)));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `.mana-input{display:flex;height:var(--control-h);width:100%;box-sizing:border-box;border-radius:var(--radius-input);border:1px solid var(--border);background:var(--surface-card);padding:0 10px;font:var(--type-body);color:var(--text-body);transition:border-color var(--dur) var(--ease),box-shadow var(--dur) var(--ease);outline:none}.mana-input::placeholder{color:var(--text-muted)}.mana-input:hover{border-color:var(--border-strong)}.mana-input:focus-visible{border-color:var(--primary);box-shadow:var(--ring-inset)}.mana-input:disabled{cursor:not-allowed;background:var(--bg-secondary);color:var(--text-secondary)}.mana-input[aria-invalid=true]{border-color:var(--danger)}`;
function Input({
  icon,
  error,
  style,
  wrapStyle,
  className = '',
  ...rest
}) {
  __ds_scope.useStyle('mana-input-css', CSS);
  const input = /*#__PURE__*/React.createElement("input", _extends({
    className: `mana-input ${className}`,
    "aria-invalid": error ? true : undefined,
    style: {
      ...(icon ? {
        paddingLeft: 30
      } : null),
      ...style
    }
  }, rest));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      ...wrapStyle
    }
  }, icon ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 9,
      top: '50%',
      transform: 'translateY(-50%)',
      color: 'var(--text-muted)',
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 14
  })), input) : input, error && /*#__PURE__*/React.createElement("p", {
    role: "alert",
    style: {
      margin: '4px 0 0',
      font: 'var(--type-caption)',
      color: 'var(--danger)'
    }
  }, error));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `.mana-select{appearance:none;display:flex;height:var(--control-h);width:100%;box-sizing:border-box;border-radius:var(--radius-input);border:1px solid var(--border);background:var(--surface-card);padding:0 28px 0 10px;font:var(--type-body);color:var(--text-body);transition:border-color var(--dur) var(--ease),box-shadow var(--dur) var(--ease);outline:none;cursor:pointer}.mana-select:hover{border-color:var(--border-strong)}.mana-select:focus-visible{border-color:var(--primary);box-shadow:var(--ring-inset)}.mana-select:disabled{cursor:not-allowed;background:var(--bg-secondary);color:var(--text-secondary)}.mana-select.is-placeholder{color:var(--text-muted)}`;
function Select({
  placeholder,
  options = [],
  value,
  className = '',
  style,
  children,
  ...rest
}) {
  __ds_scope.useStyle('mana-select-css', CSS);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: '100%',
      ...style
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    className: `mana-select ${!value && placeholder ? 'is-placeholder' : ''} ${className}`,
    value: value
  }, rest), placeholder && /*#__PURE__*/React.createElement("option", {
    value: "",
    disabled: true
  }, placeholder), options.map(o => typeof o === 'string' ? /*#__PURE__*/React.createElement("option", {
    key: o,
    value: o
  }, o) : /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label)), children), /*#__PURE__*/React.createElement("span", {
    style: {
      pointerEvents: 'none',
      position: 'absolute',
      right: 8,
      top: '50%',
      transform: 'translateY(-50%)',
      color: 'var(--text-muted)',
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 14
  })));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `.mana-sw{position:relative;display:inline-flex;align-items:center;gap:10px;cursor:pointer;font:var(--type-body);color:var(--text-body)}.mana-sw input{position:absolute;opacity:0;width:0;height:0}.mana-sw-track{width:32px;height:18px;border-radius:9999px;background:var(--gray-300);border:2px solid transparent;box-sizing:border-box;transition:background var(--dur) var(--ease);flex-shrink:0}.mana-sw-thumb{display:block;width:14px;height:14px;border-radius:9999px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.15);transition:transform var(--dur) var(--ease)}.mana-sw input:checked+.mana-sw-track{background:var(--primary)}.mana-sw input:checked+.mana-sw-track .mana-sw-thumb{transform:translateX(14px)}.mana-sw input:focus-visible+.mana-sw-track{box-shadow:var(--ring)}.mana-sw.is-disabled{cursor:not-allowed;opacity:.5}`;
function Switch({
  checked,
  defaultChecked,
  onChange,
  disabled,
  label,
  style,
  ...rest
}) {
  __ds_scope.useStyle('mana-sw-css', CSS);
  return /*#__PURE__*/React.createElement("label", {
    className: `mana-sw ${disabled ? 'is-disabled' : ''}`,
    style: style
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    role: "switch",
    checked: checked,
    defaultChecked: defaultChecked,
    onChange: onChange,
    disabled: disabled
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "mana-sw-track"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mana-sw-thumb"
  })), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `.mana-textarea{display:flex;min-height:96px;width:100%;box-sizing:border-box;resize:vertical;border-radius:var(--radius-input);border:1px solid var(--border);background:var(--surface-card);padding:8px 10px;font:var(--type-body);color:var(--text-body);transition:border-color var(--dur) var(--ease),box-shadow var(--dur) var(--ease);outline:none}.mana-textarea::placeholder{color:var(--text-muted)}.mana-textarea:hover{border-color:var(--border-strong)}.mana-textarea:focus-visible{border-color:var(--primary);box-shadow:var(--ring-inset)}.mana-textarea:disabled{cursor:not-allowed;background:var(--bg-secondary)}`;
function Textarea({
  className = '',
  ...rest
}) {
  __ds_scope.useStyle('mana-textarea-css', CSS);
  return /*#__PURE__*/React.createElement("textarea", _extends({
    className: `mana-textarea ${className}`
  }, rest));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Accordion.jsx
try { (() => {
const CSS = `.mana-acc-trigger{display:flex;flex:1;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:16px 0;border:0;background:transparent;font:var(--type-label);color:var(--text-body);cursor:pointer;text-align:left}.mana-acc-trigger:hover{text-decoration:underline}.mana-acc-trigger .mana-acc-chev{transition:transform var(--dur) var(--ease);color:var(--text-muted)}.mana-acc-trigger[aria-expanded=true] .mana-acc-chev{transform:rotate(180deg)}`;
function Accordion({
  items = [],
  defaultOpen = [],
  multiple = true,
  style
}) {
  __ds_scope.useStyle('mana-acc-css', CSS);
  const [open, setOpen] = React.useState(new Set(defaultOpen));
  const toggle = id => setOpen(prev => {
    const n = new Set(multiple ? prev : []);
    if (prev.has(id)) n.delete(id);else n.add(id);
    return n;
  });
  return /*#__PURE__*/React.createElement("div", {
    style: style
  }, items.map(it => /*#__PURE__*/React.createElement("div", {
    key: it.id,
    style: {
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "mana-acc-trigger",
    "aria-expanded": open.has(it.id),
    onClick: () => toggle(it.id)
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, it.title, it.count != null && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-caption)',
      color: 'var(--text-muted)',
      fontWeight: 400
    }
  }, it.count)), /*#__PURE__*/React.createElement("span", {
    className: "mana-acc-chev",
    style: {
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down"
  })))), open.has(it.id) && /*#__PURE__*/React.createElement("div", {
    style: {
      paddingBottom: 16,
      font: 'var(--type-body)',
      color: 'var(--text-secondary)',
      animation: 'mana-fade-in var(--dur) var(--ease-out)'
    }
  }, it.content))));
}
Object.assign(__ds_scope, { Accordion });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Accordion.jsx", error: String((e && e.message) || e) }); }

// components/navigation/CommandPalette.jsx
try { (() => {
const CSS = `.mana-cmd-item{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;border:0;background:transparent;border-radius:var(--radius-lg);padding:8px;font:var(--type-body);color:var(--text-body);cursor:pointer;text-align:left;outline:none}.mana-cmd-item:hover,.mana-cmd-item[aria-selected=true]{background:var(--bg-tertiary)}.mana-cmd-input{flex:1;height:40px;border:0;background:transparent;outline:none;font:var(--type-body);color:var(--text-body)}.mana-cmd-input::placeholder{color:var(--text-muted)}`;
function CommandPalette({
  groups = [],
  placeholder = 'Rechercher un client, un professionnel, une demande…',
  query: q,
  onQueryChange,
  onSelect,
  emptyText = 'Aucun résultat.',
  style
}) {
  __ds_scope.useStyle('mana-cmd-css', CSS);
  const [local, setLocal] = React.useState('');
  const query = q ?? local;
  const filtered = groups.map(g => ({
    ...g,
    items: g.items.filter(it => !query || it.label.toLowerCase().includes(query.toLowerCase()))
  })).filter(g => g.items.length);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      borderRadius: 'var(--radius-menu)',
      background: 'var(--surface-card)',
      border: '1px solid var(--border)',
      boxShadow: 'var(--shadow-large)',
      overflow: 'hidden',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      borderBottom: '1px solid var(--border)',
      padding: '0 12px',
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "search"
  }), /*#__PURE__*/React.createElement("input", {
    className: "mana-cmd-input",
    autoFocus: true,
    placeholder: placeholder,
    value: query,
    onChange: e => {
      setLocal(e.target.value);
      onQueryChange && onQueryChange(e.target.value);
    }
  }), /*#__PURE__*/React.createElement("kbd", {
    style: {
      font: 'var(--type-caption)',
      fontFamily: 'var(--font-sans)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      padding: '0 5px'
    }
  }, "Esc")), /*#__PURE__*/React.createElement("div", {
    style: {
      maxHeight: 300,
      overflowY: 'auto',
      padding: 4
    }
  }, filtered.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: {
      padding: '24px 0',
      textAlign: 'center',
      font: 'var(--type-body)',
      color: 'var(--text-muted)',
      margin: 0
    }
  }, emptyText), filtered.map((g, gi) => /*#__PURE__*/React.createElement("div", {
    key: g.label,
    style: {
      padding: 4
    }
  }, gi > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: 'var(--border)',
      margin: '0 -8px 8px'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '6px 8px',
      font: 'var(--type-overline)',
      color: 'var(--text-muted)'
    }
  }, g.label), g.items.map((it, i) => /*#__PURE__*/React.createElement("button", {
    key: it.id || i,
    type: "button",
    className: "mana-cmd-item",
    "aria-selected": gi === 0 && i === 0,
    onClick: () => onSelect && onSelect(it)
  }, it.icon && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: it.icon
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, it.label), it.hint && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-caption)',
      color: 'var(--text-muted)'
    }
  }, it.hint)))))));
}
Object.assign(__ds_scope, { CommandPalette });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/CommandPalette.jsx", error: String((e && e.message) || e) }); }

// components/navigation/DropdownMenu.jsx
try { (() => {
const CSS = `.mana-menu-item{position:relative;display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;border:0;background:transparent;border-radius:var(--radius-lg);padding:6px 8px;font:var(--type-body);color:var(--text-body);cursor:pointer;text-align:left;outline:none;transition:background var(--dur-fast) var(--ease)}.mana-menu-item:hover,.mana-menu-item:focus-visible{background:var(--bg-secondary)}.mana-menu-item[data-tone=danger]{color:var(--danger)}.mana-menu-item:disabled{opacity:.5;pointer-events:none}`;
function DropdownMenu({
  trigger,
  items = [],
  align = 'end',
  open: openProp,
  onOpenChange,
  style
}) {
  __ds_scope.useStyle('mana-menu-css', CSS);
  const [openState, setOpen] = React.useState(false);
  const open = openProp ?? openState;
  const set = v => {
    setOpen(v);
    onOpenChange && onOpenChange(v);
  };
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = e => {
      if (ref.current && !ref.current.contains(e.target)) set(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: 'relative',
      display: 'inline-flex',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => set(!open),
    style: {
      display: 'inline-flex'
    }
  }, trigger), open && /*#__PURE__*/React.createElement("div", {
    role: "menu",
    style: {
      position: 'absolute',
      top: '100%',
      [align === 'end' ? 'right' : 'left']: 0,
      marginTop: 4,
      zIndex: 50,
      minWidth: 180,
      borderRadius: 'var(--radius-menu)',
      border: '1px solid var(--border)',
      background: 'var(--surface-card)',
      padding: 4,
      boxShadow: 'var(--shadow-medium)',
      animation: 'mana-zoom-in var(--dur-fast) var(--ease-out)'
    }
  }, items.map((it, i) => it === '-' || it.type === 'separator' ? /*#__PURE__*/React.createElement("div", {
    key: i,
    role: "separator",
    style: {
      height: 1,
      background: 'var(--border)',
      margin: '4px -4px'
    }
  }) : it.type === 'label' ? /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      padding: '6px 8px',
      font: 'var(--type-overline)',
      color: 'var(--text-muted)'
    }
  }, it.label) : /*#__PURE__*/React.createElement("button", {
    key: i,
    type: "button",
    role: "menuitem",
    className: "mana-menu-item",
    "data-tone": it.tone,
    disabled: it.disabled,
    onClick: () => {
      set(false);
      it.onSelect && it.onSelect();
    }
  }, it.icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: it.icon
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, it.label), it.shortcut && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-caption)',
      color: 'var(--text-muted)'
    }
  }, it.shortcut)))));
}
Object.assign(__ds_scope, { DropdownMenu });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/DropdownMenu.jsx", error: String((e && e.message) || e) }); }

// components/navigation/NavTabs.jsx
try { (() => {
const CSS = `.mana-tab{display:flex;align-items:center;gap:6px;padding:8px 2px;margin:0 12px -1px 0;border:0;border-bottom:2px solid transparent;background:transparent;font:var(--type-body);color:var(--text-secondary);cursor:pointer;transition:color var(--dur) var(--ease),border-color var(--dur) var(--ease);white-space:nowrap}.mana-tab:hover{color:var(--text-body)}.mana-tab[aria-selected=true]{color:var(--text-body);font-weight:500;border-bottom-color:var(--ink)}`;
function NavTabs({
  tabs = [],
  value,
  onChange,
  style
}) {
  __ds_scope.useStyle('mana-tabs-css', CSS);
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    style: {
      display: 'flex',
      borderBottom: '1px solid var(--border)',
      overflowX: 'auto',
      ...style
    }
  }, tabs.map(t => {
    const o = typeof t === 'string' ? {
      id: t,
      label: t
    } : t;
    return /*#__PURE__*/React.createElement("button", {
      key: o.id,
      type: "button",
      role: "tab",
      tabIndex: -1,
      "aria-selected": o.id === value,
      className: "mana-tab",
      onClick: () => onChange && onChange(o.id)
    }, o.icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: o.icon,
      size: 14
    }), o.label, o.count != null && /*#__PURE__*/React.createElement("span", {
      style: {
        font: 'var(--type-caption)',
        color: 'var(--text-muted)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, o.count));
  }));
}
Object.assign(__ds_scope, { NavTabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/NavTabs.jsx", error: String((e && e.message) || e) }); }

// components/navigation/PageHeader.jsx
try { (() => {
function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 12,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, breadcrumb && /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-caption)',
      color: 'var(--text-muted)',
      marginBottom: 2,
      display: 'flex',
      gap: 6
    }
  }, breadcrumb), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: 'var(--type-page-title)',
      letterSpacing: 'var(--tracking-tight)',
      color: 'var(--text-body)'
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      font: 'var(--type-body)',
      color: 'var(--text-secondary)'
    }
  }, subtitle)), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flexShrink: 0
    }
  }, actions));
}
Object.assign(__ds_scope, { PageHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/PageHeader.jsx", error: String((e && e.message) || e) }); }

// components/navigation/SettingsNav.jsx
try { (() => {
const CSS = `.mana-snav-link{display:flex;align-items:center;gap:8px;border-radius:var(--radius-md);padding:5px 8px;font:var(--type-body);color:var(--text-secondary);text-decoration:none;cursor:pointer;transition:background var(--dur-fast) var(--ease)}.mana-snav-link:hover{background:var(--bg-secondary);color:var(--text-body);text-decoration:none}.mana-snav-link[aria-current=page]{background:var(--bg-secondary);color:var(--text-body);font-weight:500}`;
function SettingsNav({
  groups = [],
  active,
  onNavigate,
  style
}) {
  __ds_scope.useStyle('mana-snav-css', CSS);
  return /*#__PURE__*/React.createElement("nav", {
    "aria-label": "Sections des param\xE8tres",
    style: {
      width: 'var(--settings-nav-w)',
      flexShrink: 0,
      ...style
    }
  }, groups.map(g => /*#__PURE__*/React.createElement("div", {
    key: g.label,
    role: "group",
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 2px',
      padding: '0 8px',
      font: 'var(--type-overline)',
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-wide)',
      color: 'var(--text-muted)'
    }
  }, g.label), g.items.map(s => /*#__PURE__*/React.createElement("a", {
    key: s.id,
    href: "#",
    className: "mana-snav-link",
    "aria-current": s.id === active ? 'page' : undefined,
    onClick: e => {
      e.preventDefault();
      onNavigate && onNavigate(s.id);
    }
  }, s.icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: s.icon,
    size: 14,
    style: {
      color: 'var(--text-muted)'
    }
  }), s.label, s.readOnly && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "lock",
    size: 12,
    style: {
      marginLeft: 'auto',
      color: 'var(--text-muted)'
    }
  }))))));
}
Object.assign(__ds_scope, { SettingsNav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/SettingsNav.jsx", error: String((e && e.message) || e) }); }

// components/navigation/SidebarNav.jsx
try { (() => {
const CSS = `.mana-nav-link{display:flex;align-items:center;gap:10px;border-radius:var(--radius-nav);padding:6px 8px;font:var(--type-body);color:var(--text-secondary);text-decoration:none;cursor:pointer;border:0;background:transparent;width:100%;box-sizing:border-box;text-align:left;transition:background var(--dur-fast) var(--ease),color var(--dur-fast) var(--ease)}.mana-nav-link:hover{background:rgba(31,31,32,.05);color:var(--text-body);text-decoration:none}.mana-nav-link[aria-current=page]{background:var(--surface-card);color:var(--text-body);font-weight:500;box-shadow:0 0 0 1px var(--border)}.mana-nav-link .mana-nav-ico{color:var(--text-muted);display:flex}.mana-nav-link[aria-current=page] .mana-nav-ico{color:var(--text-body)}.mana-nav-sect{padding:12px 8px 4px;font:var(--type-overline);text-transform:uppercase;letter-spacing:var(--tracking-wide);color:var(--text-muted)}`;
function SidebarNav({
  items = [],
  active,
  onNavigate,
  user,
  roleLabel,
  onSignOut,
  collapsed,
  logoSrc,
  orgName = 'Clinique MANA',
  footer,
  style
}) {
  __ds_scope.useStyle('mana-nav-css', CSS);
  const w = collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)';
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: w,
      minWidth: w,
      height: '100%',
      background: 'var(--surface-sidebar)',
      boxSizing: 'border-box',
      transition: 'width var(--dur) var(--ease)',
      padding: '0 8px',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 'var(--topbar-h)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 8px',
      flexShrink: 0
    }
  }, logoSrc ? /*#__PURE__*/React.createElement("img", {
    src: logoSrc,
    alt: orgName,
    style: {
      height: 22,
      maxWidth: collapsed ? 32 : 120,
      objectFit: 'contain',
      objectPosition: 'left'
    }
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-label)',
      color: 'var(--text-body)'
    }
  }, collapsed ? 'M' : orgName)), /*#__PURE__*/React.createElement("nav", {
    "aria-label": "Menu principal",
    style: {
      flex: 1,
      overflowY: 'auto',
      paddingTop: 4,
      display: 'flex',
      flexDirection: 'column',
      gap: 1
    }
  }, items.map((it, i) => it.section ? !collapsed && /*#__PURE__*/React.createElement("div", {
    key: 's' + i,
    className: "mana-nav-sect"
  }, it.section) : /*#__PURE__*/React.createElement("a", {
    key: it.id,
    href: it.href || '#',
    className: "mana-nav-link",
    "aria-current": it.id === active ? 'page' : undefined,
    title: collapsed ? it.label : undefined,
    onClick: e => {
      e.preventDefault();
      onNavigate && onNavigate(it.id);
    },
    style: collapsed ? {
      justifyContent: 'center',
      padding: 8
    } : null
  }, /*#__PURE__*/React.createElement("span", {
    className: "mana-nav-ico"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: it.icon,
    size: 16
  })), !collapsed && /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, it.label), !collapsed && it.badge != null && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-caption)',
      fontWeight: 500,
      color: 'var(--text-muted)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, it.badge)))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 0 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, footer, user && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 8px',
      justifyContent: collapsed ? 'center' : 'flex-start'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Avatar, {
    name: user,
    size: "sm",
    tone: "neutral"
  }), !collapsed && /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-label)',
      color: 'var(--text-body)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, user), roleLabel && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-caption)',
      color: 'var(--text-muted)'
    }
  }, roleLabel)), !collapsed && onSignOut && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "mana-nav-link",
    "aria-label": "Se d\xE9connecter",
    title: "Se d\xE9connecter",
    onClick: onSignOut,
    style: {
      width: 'auto',
      padding: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "mana-nav-ico"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "log-out",
    size: 14
  }))))));
}
Object.assign(__ds_scope, { SidebarNav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/SidebarNav.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Topbar.jsx
try { (() => {
const CSS = `.mana-topbar-ico{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:var(--radius-md);border:0;background:transparent;color:var(--text-secondary);cursor:pointer;position:relative;transition:background var(--dur-fast) var(--ease)}.mana-topbar-ico:hover{background:var(--bg-secondary);color:var(--text-body)}.mana-topbar-search{display:flex;align-items:center;gap:8px;height:28px;padding:0 6px 0 8px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface-card);color:var(--text-muted);font:var(--type-body);cursor:text;min-width:200px;transition:border-color var(--dur) var(--ease)}.mana-topbar-search:hover{border-color:var(--border-strong)}`;
function Topbar({
  title,
  crumbs,
  onSearch,
  notifications,
  user,
  actions,
  onToggleSidebar,
  style
}) {
  __ds_scope.useStyle('mana-topbar-css', CSS);
  return /*#__PURE__*/React.createElement("header", {
    style: {
      height: 'var(--topbar-h)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      padding: '0 var(--page-pad)',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg)',
      boxSizing: 'border-box',
      flexShrink: 0,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      minWidth: 0,
      flex: 1,
      font: 'var(--type-label)',
      color: 'var(--text-body)'
    }
  }, onToggleSidebar && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "mana-topbar-ico",
    "aria-label": "R\xE9duire le menu",
    onClick: onToggleSidebar
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "panel-left",
    size: 16
  })), crumbs && crumbs.map((c, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      fontWeight: 400
    }
  }, c), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)'
    }
  }, "/"))), /*#__PURE__*/React.createElement("span", {
    style: {
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, title)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flexShrink: 0
    }
  }, actions, onSearch && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "mana-topbar-search",
    onClick: onSearch
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "search",
    size: 14
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      textAlign: 'left'
    }
  }, "Rechercher\u2026"), /*#__PURE__*/React.createElement("kbd", {
    style: {
      font: 'var(--type-overline)',
      fontFamily: 'var(--font-sans)',
      background: 'var(--bg-secondary)',
      borderRadius: 4,
      padding: '1px 4px',
      color: 'var(--text-secondary)'
    }
  }, "\u2318K")), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "mana-topbar-ico",
    "aria-label": "Notifications"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "bell",
    size: 16
  }), notifications > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 5,
      right: 6,
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: 'var(--primary)',
      border: '2px solid var(--bg)'
    }
  })), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "mana-topbar-ico",
    "aria-label": "Aide"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "circle-help",
    size: 16
  })), user && /*#__PURE__*/React.createElement(__ds_scope.Avatar, {
    name: user,
    size: "sm",
    tone: "neutral"
  })));
}
Object.assign(__ds_scope, { Topbar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Topbar.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Dialog.jsx
try { (() => {
const CSS = `.mana-dialog-close{position:absolute;right:16px;top:16px;display:flex;border:0;background:transparent;border-radius:var(--radius-lg);padding:4px;opacity:.7;cursor:pointer;color:var(--text-body);transition:opacity var(--dur) var(--ease)}.mana-dialog-close:hover{opacity:1}.mana-dialog-close:focus-visible{outline:none;box-shadow:var(--ring)}`;
function Dialog({
  open = true,
  onClose,
  title,
  description,
  footer,
  hideClose,
  maxWidth = 512,
  inline,
  children,
  style
}) {
  __ds_scope.useStyle('mana-dialog-css', CSS);
  React.useEffect(() => {
    if (!open || inline) return;
    const h = e => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, inline, onClose]);
  if (!open) return null;
  const panel = /*#__PURE__*/React.createElement("div", {
    role: "dialog",
    "aria-modal": !inline,
    "aria-labelledby": title ? 'mana-dialog-title' : undefined,
    style: {
      position: 'relative',
      width: '100%',
      maxWidth,
      boxSizing: 'border-box',
      display: 'grid',
      gap: 14,
      borderRadius: 'var(--radius-dialog)',
      background: 'var(--surface-card)',
      padding: 20,
      boxShadow: 'var(--shadow-large)',
      animation: inline ? undefined : 'mana-zoom-in var(--dur) var(--ease-out)',
      ...style
    }
  }, (title || description) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      paddingRight: hideClose ? 0 : 24
    }
  }, title && /*#__PURE__*/React.createElement("h2", {
    id: "mana-dialog-title",
    style: {
      margin: 0,
      font: 'var(--type-section-title)',
      color: 'var(--text-body)'
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-body)',
      color: 'var(--text-secondary)'
    }
  }, description)), children, footer && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 8
    }
  }, footer), !hideClose && /*#__PURE__*/React.createElement("button", {
    type: "button",
    tabIndex: -1,
    className: "mana-dialog-close",
    "aria-label": "Fermer",
    onClick: onClose
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x"
  })));
  if (inline) return panel;
  return /*#__PURE__*/React.createElement("div", {
    onMouseDown: e => {
      if (e.target === e.currentTarget && onClose) onClose();
    },
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      background: 'var(--surface-overlay)',
      backdropFilter: 'blur(var(--blur-overlay))',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      animation: 'mana-fade-in var(--dur) var(--ease-out)'
    }
  }, panel);
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/overlays/AlertDialog.jsx
try { (() => {
function AlertDialog({
  open = true,
  title,
  description,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  destructive,
  onConfirm,
  onCancel,
  inline,
  busy
}) {
  return /*#__PURE__*/React.createElement(__ds_scope.Dialog, {
    open: open,
    inline: inline,
    hideClose: true,
    title: title,
    description: description,
    onClose: onCancel,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(__ds_scope.Button, {
      variant: "outline",
      onClick: onCancel,
      disabled: busy
    }, cancelLabel), /*#__PURE__*/React.createElement(__ds_scope.Button, {
      variant: destructive ? 'destructive' : 'default',
      onClick: onConfirm,
      disabled: busy
    }, confirmLabel))
  });
}
Object.assign(__ds_scope, { AlertDialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/AlertDialog.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Popover.jsx
try { (() => {
function Popover({
  trigger,
  children,
  open: openProp,
  onOpenChange,
  align = 'start',
  width = 288,
  style
}) {
  const [openState, setOpen] = React.useState(false);
  const open = openProp ?? openState;
  const set = v => {
    setOpen(v);
    onOpenChange && onOpenChange(v);
  };
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = e => {
      if (ref.current && !ref.current.contains(e.target)) set(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: 'relative',
      display: 'inline-flex',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => set(!open),
    style: {
      display: 'inline-flex'
    }
  }, trigger), open && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: '100%',
      [align === 'end' ? 'right' : 'left']: 0,
      marginTop: 4,
      zIndex: 50,
      width,
      boxSizing: 'border-box',
      borderRadius: 'var(--radius-menu)',
      border: '1px solid var(--border)',
      background: 'var(--surface-card)',
      padding: 16,
      boxShadow: 'var(--shadow-medium)',
      animation: 'mana-zoom-in var(--dur-fast) var(--ease-out)'
    }
  }, children));
}
Object.assign(__ds_scope, { Popover });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Popover.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Sheet.jsx
try { (() => {
const CSS = `.mana-sheet-close{display:flex;border:0;background:transparent;border-radius:var(--radius-lg);padding:4px;opacity:.7;cursor:pointer;color:var(--text-body)}.mana-sheet-close:hover{opacity:1}`;
function Sheet({
  open = true,
  onClose,
  title,
  description,
  header,
  footer,
  side = 'right',
  width = 480,
  inline,
  children,
  style
}) {
  __ds_scope.useStyle('mana-sheet-css', CSS);
  if (!open) return null;
  const vertical = side === 'top' || side === 'bottom';
  const panel = /*#__PURE__*/React.createElement("div", {
    role: "dialog",
    "aria-modal": !inline,
    style: {
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--surface-card)',
      boxShadow: 'var(--shadow-large)',
      boxSizing: 'border-box',
      ...(inline ? {
        width: vertical ? '100%' : width,
        height: '100%',
        borderLeft: '1px solid var(--border)'
      } : {
        position: 'fixed',
        zIndex: 50,
        [side]: 0,
        ...(vertical ? {
          left: 0,
          right: 0,
          maxHeight: '80vh'
        } : {
          top: 0,
          bottom: 0,
          width,
          maxWidth: '100vw'
        }),
        [vertical ? side === 'top' ? 'borderBottom' : 'borderTop' : side === 'right' ? 'borderLeft' : 'borderRight']: '1px solid var(--border)',
        animation: side === 'right' ? 'mana-slide-in-right var(--dur-slow) var(--ease-out)' : 'mana-fade-in var(--dur-slow) var(--ease-out)'
      }),
      ...style
    }
  }, header || /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
      padding: '16px 20px 12px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 0
    }
  }, title && /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: 'var(--type-section-title)',
      color: 'var(--text-body)'
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-body)',
      color: 'var(--text-secondary)'
    }
  }, description)), /*#__PURE__*/React.createElement("button", {
    type: "button",
    tabIndex: -1,
    className: "mana-sheet-close",
    "aria-label": "Fermer",
    onClick: onClose
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '0 20px 20px'
    }
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 8,
      padding: 12,
      borderTop: '1px solid var(--border)'
    }
  }, footer));
  if (inline) return panel;
  return /*#__PURE__*/React.createElement("div", {
    onMouseDown: e => {
      if (e.target === e.currentTarget && onClose) onClose();
    },
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      background: 'var(--surface-overlay)',
      backdropFilter: 'blur(var(--blur-overlay))',
      animation: 'mana-fade-in var(--dur) var(--ease-out)'
    }
  }, panel);
}
Object.assign(__ds_scope, { Sheet });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Sheet.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Toast.jsx
try { (() => {
const CSS = `.mana-toast-x{display:flex;border:0;background:transparent;padding:2px;border-radius:4px;cursor:pointer;color:rgba(255,255,255,.6)}.mana-toast-x:hover{color:#fff}`;
const V = {
  default: ['info', 'rgba(255,255,255,.7)'],
  success: ['circle-check', 'var(--teal-300)'],
  error: ['circle-alert', '#F7A3BB'],
  warning: ['triangle-alert', 'var(--yellow-300)']
};
function Toast({
  variant = 'default',
  title,
  description,
  action,
  onDismiss,
  style
}) {
  __ds_scope.useStyle('mana-toast-css', CSS);
  const [icon, color] = V[variant] || V.default;
  return /*#__PURE__*/React.createElement("div", {
    role: "status",
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      width: 356,
      maxWidth: '100%',
      boxSizing: 'border-box',
      borderRadius: 'var(--radius-card)',
      background: 'var(--ink)',
      color: '#fff',
      padding: '10px 12px',
      boxShadow: 'var(--shadow-large)',
      animation: 'mana-zoom-in var(--dur) var(--ease-out)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      color,
      marginTop: 1
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-label)',
      color: '#fff'
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      font: 'var(--type-body)',
      color: 'rgba(255,255,255,.7)'
    }
  }, description), action && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, action)), onDismiss && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "mana-toast-x",
    "aria-label": "Fermer",
    onClick: onDismiss
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x",
    size: 14
  })));
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Toast.jsx", error: String((e && e.message) || e) }); }

// ui_kits/clinique-mana-app/Accueil.jsx
try { (() => {
function Accueil({
  role,
  setPage
}) {
  const {
    Card,
    Badge,
    Avatar,
    Button,
    Icon
  } = DS;
  const r = ROLES[role];
  const first = r.user.split(' ')[0];
  const showDemandes = r.nav.includes('demandes');
  const showFact = r.nav.includes('facturation');
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: 'var(--type-page-title)',
      letterSpacing: 'var(--tracking-tight)'
    }
  }, "Bonjour ", first), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-body)',
      color: 'var(--text-muted)'
    }
  }, "Mercredi 7 octobre 2026")), /*#__PURE__*/React.createElement(Card, {
    padding: 0,
    style: {
      flexDirection: 'row',
      overflow: 'hidden'
    }
  }, showDemandes && /*#__PURE__*/React.createElement(Figure, {
    label: "Demandes \xE0 rappeler",
    value: "4",
    hint: "2 d\xE9passent 24 h",
    tone: "warn",
    onClick: () => setPage('demandes')
  }), /*#__PURE__*/React.createElement(Figure, {
    label: "Rendez-vous aujourd'hui",
    value: "12",
    hint: "4 ce matin \xB7 100 % en ligne",
    onClick: () => setPage('rendez-vous')
  }), /*#__PURE__*/React.createElement(Figure, {
    label: "Documents qui expirent",
    value: "2",
    hint: "dans les 30 prochains jours",
    onClick: () => setPage('professionnels')
  }), showFact ? /*#__PURE__*/React.createElement(Figure, {
    label: "Factures impay\xE9es",
    value: "3 180 $",
    hint: "7 factures \xB7 2 IVAC",
    onClick: () => setPage('facturation')
  }) : /*#__PURE__*/React.createElement(Figure, {
    label: "Professionnels actifs",
    value: "48",
    hint: "sur 52",
    onClick: () => setPage('professionnels')
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: showDemandes ? 'repeat(auto-fit, minmax(320px,1fr))' : '1fr',
      gap: 20
    }
  }, showDemandes && /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("div", {
    className: "kit-sec"
  }, /*#__PURE__*/React.createElement("h3", null, "\xC0 rappeler"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    onClick: () => setPage('demandes')
  }, "Toutes les demandes ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    size: 12
  }))), /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, DEMANDES.filter(d => d.status === 'À rappeler').concat(DEMANDES[2]).map((d, i) => /*#__PURE__*/React.createElement(Row, {
    key: d.id,
    cols: "24px 1fr auto auto",
    onClick: () => setPage('demandes'),
    style: {
      borderTop: i ? '1px solid var(--border)' : 0
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: d.client,
    size: "sm",
    tone: "neutral"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-label)'
    }
  }, d.client), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-caption)',
      color: 'var(--text-muted)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, d.motifs.join(' · '), " \xB7 ", d.source)), d.urgency === 'haute' ? /*#__PURE__*/React.createElement(Badge, {
    variant: "error",
    filled: true
  }, "Urgent") : /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("span", {
    className: "kit-num kit-muted",
    style: {
      font: 'var(--type-caption)'
    }
  }, d.age))))), /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("div", {
    className: "kit-sec"
  }, /*#__PURE__*/React.createElement("h3", null, "Aujourd'hui"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    onClick: () => setPage('rendez-vous')
  }, "Agenda ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    size: 12
  }))), /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, RDV.map((a, i) => /*#__PURE__*/React.createElement(Row, {
    key: a.time,
    cols: "44px 1fr auto",
    style: {
      borderTop: i ? '1px solid var(--border)' : 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "kit-num",
    style: {
      font: 'var(--type-label)'
    }
  }, a.time), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-label)'
    }
  }, a.client), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-caption)',
      color: 'var(--text-muted)'
    }
  }, a.pro, " \xB7 ", a.type)), /*#__PURE__*/React.createElement("span", {
    className: "kit-row",
    style: {
      gap: 4,
      font: 'var(--type-caption)',
      color: 'var(--text-secondary)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: a.mode === 'Vidéo' ? 'video' : 'phone',
    size: 12
  }), a.mode)))))), /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("div", {
    className: "kit-sec"
  }, /*#__PURE__*/React.createElement("h3", null, "\xC0 surveiller")), /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, /*#__PURE__*/React.createElement(Row, {
    cols: "16px 1fr auto",
    onClick: () => setPage('professionnels')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "triangle-alert",
    size: 14,
    style: {
      color: 'var(--warning)'
    }
  }), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", {
    style: {
      fontWeight: 500
    }
  }, "Sophie Lavoie"), " \xB7 assurance responsabilit\xE9 expire le 19 oct. \u2014 d\xE9sactivation automatique sans renouvellement"), /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "sm"
  }, "Voir la fiche")), /*#__PURE__*/React.createElement(Row, {
    cols: "16px 1fr auto",
    onClick: () => setPage('professionnels'),
    style: {
      borderTop: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clock",
    size: 14,
    style: {
      color: 'var(--neutral-dot)'
    }
  }), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", {
    style: {
      fontWeight: 500
    }
  }, "Marc-Antoine Roy"), " \xB7 invitation sans r\xE9ponse depuis 6 jours"), /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "sm"
  }, "Relancer")))));
}
window.Accueil = Accueil;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/clinique-mana-app/Accueil.jsx", error: String((e && e.message) || e) }); }

// ui_kits/clinique-mana-app/App.jsx
try { (() => {
function App() {
  const [page, setPage] = React.useState(localStorage.getItem('mana-kit-page') || 'login');
  const [role, setRole] = React.useState(localStorage.getItem('mana-kit-role') || 'admin');
  const [selected, setSelected] = React.useState(null);
  React.useEffect(() => {
    localStorage.setItem('mana-kit-page', page);
    localStorage.setItem('mana-kit-role', role);
  }, [page, role]);
  const go = p => {
    setSelected(null);
    setPage(p);
  };
  if (page === 'login') return /*#__PURE__*/React.createElement(Login, {
    onLogin: () => setPage('accueil')
  });
  const title = page === 'professionnels' && selected ? selected.name : (NAV[page] || NAV.accueil).label;
  const crumbs = page === 'professionnels' && selected ? ['Professionnels'] : undefined;
  return /*#__PURE__*/React.createElement(Shell, {
    role: role,
    setRole: r => {
      setRole(r);
      if (!ROLES[r].nav.includes(page)) go('accueil');
    },
    page: page,
    setPage: go,
    title: title,
    crumbs: crumbs
  }, page === 'accueil' && /*#__PURE__*/React.createElement(Accueil, {
    role: role,
    setPage: go
  }), page === 'professionnels' && /*#__PURE__*/React.createElement(Professionnels, {
    role: role,
    selected: selected,
    setSelected: setSelected
  }), page === 'demandes' && /*#__PURE__*/React.createElement(Demandes, null), page === 'parametres' && /*#__PURE__*/React.createElement(Parametres, {
    key: role,
    role: role
  }), ['clients', 'rendez-vous', 'facturation'].includes(page) && /*#__PURE__*/React.createElement(DS.EmptyState, {
    title: NAV[page].label + ' — module en préparation',
    description: "Cet \xE9cran sera con\xE7u avec le module correspondant. Il reprendra la liste, la fiche et le tiroir des pages Professionnels et Demandes."
  }));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/clinique-mana-app/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/clinique-mana-app/Demandes.jsx
try { (() => {
function Demandes() {
  const {
    Card,
    Badge,
    Avatar,
    Button,
    Icon,
    Input,
    Select,
    PageHeader,
    Label,
    Textarea,
    Checkbox
  } = DS;
  const [open, setOpen] = React.useState(DEMANDES[0]);
  const [filter, setFilter] = React.useState('all');
  const list = DEMANDES.filter(d => filter === 'all' || d.status === filter);
  const tone = s => s === 'À rappeler' ? 'warning' : s === 'Jumelage proposé' ? 'success' : 'info';
  const cols = '72px minmax(0,2fr) minmax(0,1.3fr) minmax(150px,1.3fr) 48px';
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Demandes",
    subtitle: "Promesse de rappel en 24\u201348 h ouvrables",
    actions: /*#__PURE__*/React.createElement(Button, null, /*#__PURE__*/React.createElement(Icon, {
      name: "plus",
      size: 14
    }), " Nouvelle demande")
  }), /*#__PURE__*/React.createElement("div", {
    className: "kit-row",
    style: {
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Input, {
    icon: "search",
    placeholder: "Rechercher un client ou un num\xE9ro\u2026",
    wrapStyle: {
      maxWidth: 280
    }
  }), /*#__PURE__*/React.createElement(Select, {
    value: filter,
    onChange: e => setFilter(e.target.value),
    style: {
      width: 200
    },
    options: [{
      value: 'all',
      label: 'Toutes les étapes'
    }, {
      value: 'À rappeler',
      label: 'À rappeler'
    }, {
      value: 'Appel découverte fait',
      label: 'Appel découverte fait'
    }, {
      value: 'Jumelage proposé',
      label: 'Jumelage proposé'
    }]
  })), /*#__PURE__*/React.createElement("div", {
    className: "kit-split"
  }, /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, /*#__PURE__*/React.createElement(Head, {
    cols: cols
  }, /*#__PURE__*/React.createElement("span", null, "N\xB0"), /*#__PURE__*/React.createElement("span", null, "Client"), /*#__PURE__*/React.createElement("span", null, "Motifs"), /*#__PURE__*/React.createElement("span", null, "\xC9tape"), /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: 'right'
    }
  }, "\xC2ge")), list.map(d => /*#__PURE__*/React.createElement(Row, {
    key: d.id,
    cols: cols,
    onClick: () => setOpen(d),
    className: open && open.id === d.id ? 'is-selected' : '',
    style: {
      borderTop: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "kit-num kit-muted",
    style: {
      font: 'var(--type-caption)'
    }
  }, d.id), /*#__PURE__*/React.createElement("span", {
    className: "kit-row",
    style: {
      gap: 8,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: d.client,
    size: "sm",
    tone: "neutral"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-label)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, d.client), d.urgency === 'haute' && /*#__PURE__*/React.createElement(Badge, {
    variant: "error",
    filled: true
  }, "Urgent")), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-secondary)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, d.motifs.join(' · ')), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: tone(d.status),
    style: {
      maxWidth: '100%',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, d.status)), /*#__PURE__*/React.createElement("span", {
    className: "kit-num kit-muted",
    style: {
      textAlign: 'right'
    }
  }, d.age))), /*#__PURE__*/React.createElement("div", {
    className: "kit-tfoot"
  }, /*#__PURE__*/React.createElement("span", null, list.length, " demandes"), /*#__PURE__*/React.createElement("span", null, "Page 1 sur 1"))), open ? /*#__PURE__*/React.createElement("aside", {
    className: "kit-panel",
    "aria-label": "D\xE9tail de la demande"
  }, /*#__PURE__*/React.createElement("div", {
    className: "kit-panel-h"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "kit-row",
    style: {
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      font: 'var(--type-section-title)'
    }
  }, open.client), open.urgency === 'haute' && /*#__PURE__*/React.createElement(Badge, {
    variant: "error",
    filled: true
  }, "Urgent")), /*#__PURE__*/React.createElement("p", {
    className: "kit-ellip",
    style: {
      margin: '2px 0 0',
      font: 'var(--type-caption)',
      color: 'var(--text-muted)'
    }
  }, open.id, " \xB7 re\xE7ue il y a ", open.age, " \xB7 ", open.source)), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "icon-sm",
    "aria-label": "Fermer",
    onClick: () => setOpen(null)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 14
  }))), /*#__PURE__*/React.createElement("div", {
    className: "kit-panel-b"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '8px 12px',
      font: 'var(--type-body)'
    }
  }, [['Téléphone', open.phone], ['Disponibilités', open.pref], ['Payeur externe', open.payer || 'Aucun'], ['Urgence', open.urgency === 'haute' ? 'Haute' : 'Normale']].map(([k, v]) => /*#__PURE__*/React.createElement("div", {
    key: k
  }, /*#__PURE__*/React.createElement("p", {
    className: "kit-muted",
    style: {
      margin: 0,
      font: 'var(--type-caption)'
    }
  }, k), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0
    }
  }, v)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h4", {
    className: "kit-h4"
  }, "Appel d\xE9couverte"), /*#__PURE__*/React.createElement("div", {
    className: "kit-col",
    style: {
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, null, "Motifs ", /*#__PURE__*/React.createElement("span", {
    className: "kit-muted",
    style: {
      fontWeight: 400
    }
  }, "(orientation, pas un diagnostic)")), /*#__PURE__*/React.createElement("div", {
    className: "kit-row",
    style: {
      gap: 6,
      flexWrap: 'wrap'
    }
  }, open.motifs.map(m => /*#__PURE__*/React.createElement(Badge, {
    key: m,
    dot: false
  }, m)), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 12
  }), " Ajouter"))), /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, null, "Besoin exprim\xE9"), /*#__PURE__*/React.createElement(Textarea, {
    placeholder: "En quelques mots, ce que la personne souhaite travailler\u2026",
    style: {
      minHeight: 72
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, null, "Pr\xE9f\xE9rences"), /*#__PURE__*/React.createElement("div", {
    className: "kit-row",
    style: {
      gap: 14,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(Checkbox, {
    label: "Femme"
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Homme"
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Anglais"
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Soirs",
    defaultChecked: open.pref.includes('Soirs')
  }))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h4", {
    className: "kit-h4"
  }, "Suggestions de professionnels"), /*#__PURE__*/React.createElement("p", {
    className: "kit-muted",
    style: {
      margin: '0 0 8px',
      font: 'var(--type-caption)'
    }
  }, "Vous d\xE9cidez ; l'app vous aide. Class\xE9es par sp\xE9cialit\xE9 et disponibilit\xE9."), /*#__PURE__*/React.createElement(Card, {
    padding: 0,
    variant: "outline"
  }, PROS.filter(p => p.status === 'active').slice(0, 3).map((p, i) => /*#__PURE__*/React.createElement(Row, {
    key: p.id,
    cols: "24px 1fr auto auto",
    style: {
      borderTop: i ? '1px solid var(--border)' : 0
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: p.name,
    size: "sm"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-label)'
    }
  }, p.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-caption)',
      color: 'var(--text-muted)'
    }
  }, p.profession, " \xB7 ", p.rate, ",00 $ \xB7 dispo. jeudi 18 h")), i === 0 ? /*#__PURE__*/React.createElement(Badge, {
    variant: "success"
  }, "Sp\xE9cialis\xE9") : /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement(Button, {
    variant: i === 0 ? 'default' : 'outline',
    size: "sm"
  }, "Choisir")))))), /*#__PURE__*/React.createElement("div", {
    className: "kit-panel-f"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "sm"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "phone",
    size: 14
  }), " Noter l'appel"), /*#__PURE__*/React.createElement(Button, {
    size: "sm"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "users",
    size: 14
  }), " Proposer un jumelage"))) : /*#__PURE__*/React.createElement("div", null)));
}
window.Demandes = Demandes;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/clinique-mana-app/Demandes.jsx", error: String((e && e.message) || e) }); }

// ui_kits/clinique-mana-app/Login.jsx
try { (() => {
function Login({
  onLogin
}) {
  const {
    AuthCard,
    Button,
    Input,
    Label
  } = DS;
  const [sent, setSent] = React.useState(false);
  return /*#__PURE__*/React.createElement(AuthCard, {
    logoSrc: "../../assets/logo-header.svg",
    title: "Connexion",
    subtitle: "Connectez-vous pour acc\xE9der \xE0 votre espace.",
    status: sent ? 'Si un compte existe pour ce courriel, un lien de connexion vient d\'être envoyé.' : null
  }, /*#__PURE__*/React.createElement("form", {
    onSubmit: e => {
      e.preventDefault();
      onLogin();
    },
    noValidate: true,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, {
    htmlFor: "email"
  }, "Courriel"), /*#__PURE__*/React.createElement(Input, {
    id: "email",
    type: "email",
    autoComplete: "username",
    defaultValue: "christine@cliniquemana.com"
  })), /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, {
    htmlFor: "password"
  }, "Mot de passe"), /*#__PURE__*/React.createElement(Input, {
    id: "password",
    type: "password",
    autoComplete: "current-password",
    defaultValue: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
  })), /*#__PURE__*/React.createElement(Button, {
    type: "submit",
    fullWidth: true
  }, "Se connecter"), /*#__PURE__*/React.createElement("div", {
    className: "kit-row",
    style: {
      gap: 12,
      font: 'var(--type-caption)',
      color: 'var(--text-muted)'
    },
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: 1,
      background: 'var(--border)'
    }
  }), "ou", /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: 1,
      background: 'var(--border)'
    }
  })), /*#__PURE__*/React.createElement(Button, {
    type: "button",
    variant: "outline",
    fullWidth: true,
    style: {
      whiteSpace: 'normal'
    },
    onClick: () => setSent(true)
  }, "Recevoir un lien de connexion par courriel"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "link",
    type: "button"
  }, "Mot de passe oubli\xE9 ?"))));
}
window.Login = Login;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/clinique-mana-app/Login.jsx", error: String((e && e.message) || e) }); }

// ui_kits/clinique-mana-app/Parametres.jsx
try { (() => {
function Parametres({
  role
}) {
  const {
    Card,
    Button,
    Icon,
    SettingsNav,
    Switch,
    Input,
    Label,
    Select,
    FullPageMessage,
    Alert
  } = DS;
  const readOnly = role === 'adjointe';
  const groups = readOnly ? SETTINGS_GROUPS.filter(g => g.label !== 'Plateforme').map(g => ({
    ...g,
    items: g.items.filter(i => !['banque'].includes(i.id)).map(i => ({
      ...i,
      readOnly: g.label !== 'Mon compte'
    }))
  })) : SETTINGS_GROUPS;
  const [sec, setSec] = React.useState(readOnly ? 'identite' : 'modules');
  const [mods, setMods] = React.useState(MODULES);
  const toggle = k => setMods(m => m.map(x => x.key === k ? {
    ...x,
    enabled: !x.enabled
  } : x));
  const active = groups.flatMap(g => g.items).find(i => i.id === sec) || groups[0].items[0];
  const Title = ({
    t,
    d
  }) => /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      font: 'var(--type-section-title)'
    }
  }, t), d && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      font: 'var(--type-body)',
      color: 'var(--text-secondary)'
    }
  }, d));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: 'var(--type-page-title)',
      letterSpacing: 'var(--tracking-tight)'
    }
  }, "Param\xE8tres"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 24,
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement(SettingsNav, {
    groups: groups,
    active: active.id,
    onNavigate: setSec
  }), /*#__PURE__*/React.createElement("section", {
    style: {
      flex: 1,
      minWidth: 0,
      maxWidth: 'var(--form-max)'
    }
  }, active.id === 'modules' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Title, {
    t: "Modules",
    d: "Activez un module lorsqu'il est pr\xEAt. Un module d\xE9sactiv\xE9 dispara\xEEt du menu et de l'application."
  }), /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, mods.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: m.key,
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '10px 12px',
      borderTop: i ? '1px solid var(--border)' : 0
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-label)'
    }
  }, m.name), m.depends.length > 0 && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-caption)',
      color: 'var(--text-muted)'
    }
  }, "Requiert : ", m.depends.join(', '))), /*#__PURE__*/React.createElement(Switch, {
    checked: m.enabled,
    onChange: () => toggle(m.key),
    "aria-label": m.name
  }))))), active.id === 'identite' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Title, {
    t: "Identit\xE9 l\xE9gale",
    d: "Appara\xEEt sur les re\xE7us, les factures et les contrats."
  }), readOnly && /*#__PURE__*/React.createElement(Alert, {
    style: {
      marginBottom: 12
    },
    icon: "lock",
    title: "Lecture seule"
  }, "Seule l'administration peut modifier ces informations."), /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "kit-col",
    style: {
      gridColumn: '1 / -1'
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Raison sociale"), /*#__PURE__*/React.createElement(Input, {
    defaultValue: "Clinique MANA inc.",
    disabled: readOnly
  })), /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, null, "NEQ"), /*#__PURE__*/React.createElement(Input, {
    defaultValue: "1172 345 678",
    disabled: readOnly
  })), /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, null, "T\xE9l\xE9phone"), /*#__PURE__*/React.createElement(Input, {
    defaultValue: "418 907-9754",
    disabled: readOnly
  })), /*#__PURE__*/React.createElement("div", {
    className: "kit-col",
    style: {
      gridColumn: '1 / -1'
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Adresse du si\xE8ge social"), /*#__PURE__*/React.createElement(Input, {
    defaultValue: "300-797 boul. Lebourgneuf, Qu\xE9bec (QC) G2J 0B5",
    disabled: readOnly
  })), /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, null, "Courriel"), /*#__PURE__*/React.createElement(Input, {
    defaultValue: "info@cliniquemana.com",
    disabled: readOnly
  })), /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, null, "Fuseau horaire"), /*#__PURE__*/React.createElement(Select, {
    defaultValue: "America/Toronto",
    options: ['America/Toronto', 'America/Vancouver'],
    disabled: readOnly
  }))), !readOnly && /*#__PURE__*/React.createElement("div", {
    className: "kit-row",
    style: {
      marginTop: 16,
      justifyContent: 'flex-end',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "outline"
  }, "Annuler"), /*#__PURE__*/React.createElement(Button, null, "Enregistrer")))), active.id === 'compte' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Title, {
    t: "Mon compte"
  }), /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, null, "Nom"), /*#__PURE__*/React.createElement(Input, {
    defaultValue: ROLES[role].user
  })), /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, null, "Courriel"), /*#__PURE__*/React.createElement(Input, {
    defaultValue: "prenom@cliniquemana.com"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "kit-row",
    style: {
      marginTop: 16,
      gap: 6,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "sm"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "key-round",
    size: 14
  }), " Changer le mot de passe"), /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "sm"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "log-out",
    size: 14
  }), " D\xE9connecter tous les appareils")))), !['modules', 'identite', 'compte'].includes(active.id) && /*#__PURE__*/React.createElement(FullPageMessage, {
    compact: true,
    title: active.label,
    body: "Cette section arrive dans une prochaine phase."
  }))));
}
window.Parametres = Parametres;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/clinique-mana-app/Parametres.jsx", error: String((e && e.message) || e) }); }

// ui_kits/clinique-mana-app/Professionnels.jsx
try { (() => {
function Professionnels({
  role,
  selected,
  setSelected
}) {
  const {
    Card,
    Badge,
    Avatar,
    Button,
    Icon,
    Input,
    Select,
    PageHeader,
    Dialog,
    Label,
    Checkbox,
    Toast
  } = DS;
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [add, setAdd] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const list = PROS.filter(p => (status === 'all' || p.status === status) && (!q || (p.name + p.email).toLowerCase().includes(q.toLowerCase())));
  if (selected) return /*#__PURE__*/React.createElement(Fiche, {
    pro: selected,
    role: role,
    back: () => setSelected(null)
  });
  const cols = 'minmax(0,2fr) minmax(0,1.6fr) 96px 72px minmax(0,1.4fr)';
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Professionnels",
    subtitle: PROS.length + ' professionnels · ' + PROS.filter(p => p.status === 'active').length + ' actifs',
    actions: /*#__PURE__*/React.createElement(Button, {
      onClick: () => setAdd(true)
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "plus",
      size: 14
    }), " Ajouter")
  }), /*#__PURE__*/React.createElement("div", {
    className: "kit-row",
    style: {
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Input, {
    icon: "search",
    placeholder: "Rechercher par nom ou courriel\u2026",
    value: q,
    onChange: e => setQ(e.target.value),
    wrapStyle: {
      maxWidth: 280
    }
  }), /*#__PURE__*/React.createElement(Select, {
    value: status,
    onChange: e => setStatus(e.target.value),
    style: {
      width: 160
    },
    options: [{
      value: 'all',
      label: 'Tous les statuts'
    }, {
      value: 'active',
      label: 'Actif'
    }, {
      value: 'invited',
      label: 'Invité'
    }, {
      value: 'pending',
      label: 'En attente'
    }, {
      value: 'inactive',
      label: 'Inactif'
    }]
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "filter",
    size: 14
  }), " Filtres"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "kit-muted kit-nowrap",
    style: {
      font: 'var(--type-caption)'
    }
  }, list.length, " r\xE9sultat", list.length > 1 ? 's' : '')), /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, /*#__PURE__*/React.createElement(Head, {
    cols: cols
  }, /*#__PURE__*/React.createElement("span", null, "Nom"), /*#__PURE__*/React.createElement("span", null, "Profession"), /*#__PURE__*/React.createElement("span", null, "Statut"), /*#__PURE__*/React.createElement("span", null, "Documents"), /*#__PURE__*/React.createElement("span", null, "\xC0 surveiller")), list.map(p => /*#__PURE__*/React.createElement(Row, {
    key: p.id,
    cols: cols,
    onClick: () => setSelected(p),
    style: {
      borderTop: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "kit-row",
    style: {
      gap: 10,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: p.name,
    size: "sm"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-label)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, p.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-caption)',
      color: 'var(--text-muted)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, p.email))), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, p.profession), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-caption)',
      color: 'var(--text-muted)'
    }
  }, p.order, " ", p.licence)), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(Badge, {
    variant: STATUS[p.status][0]
  }, STATUS[p.status][1])), /*#__PURE__*/React.createElement("span", {
    className: "kit-num kit-muted"
  }, p.docs, " / 3"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-caption)',
      color: p.expiring ? 'var(--danger)' : 'var(--text-muted)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, p.expiring ? 'Assurance expire ' + p.expiry.replace(' 2026', '') : p.pendingInvite ? 'Invitation sans réponse · 6 j' : p.status === 'pending' ? 'Dossier à réviser' : '—'))), /*#__PURE__*/React.createElement("div", {
    className: "kit-tfoot"
  }, /*#__PURE__*/React.createElement("span", null, list.length, " sur ", PROS.length, " professionnels"), /*#__PURE__*/React.createElement("span", {
    className: "kit-row",
    style: {
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    disabled: true
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-left",
    size: 14
  })), /*#__PURE__*/React.createElement("span", null, "Page 1 sur 1"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    disabled: true
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 14
  }))))), list.length === 0 && /*#__PURE__*/React.createElement(DS.EmptyState, {
    title: "Aucun professionnel ne correspond",
    description: "Modifiez la recherche ou les filtres.",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "outline",
      size: "sm",
      onClick: () => {
        setQ('');
        setStatus('all');
      }
    }, "R\xE9initialiser")
  }), add && /*#__PURE__*/React.createElement(Dialog, {
    open: true,
    onClose: () => setAdd(false),
    title: "Ajouter un professionnel",
    description: "Une invitation lui sera envoy\xE9e par courriel pour compl\xE9ter son profil.",
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "outline",
      onClick: () => setAdd(false)
    }, "Annuler"), /*#__PURE__*/React.createElement(Button, {
      onClick: () => {
        setAdd(false);
        setToast('Invitation envoyée.');
        setTimeout(() => setToast(null), 3000);
      }
    }, "Cr\xE9er et inviter"))
  }, /*#__PURE__*/React.createElement("div", {
    className: "kit-col",
    style: {
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, {
    required: true
  }, "Nom complet"), /*#__PURE__*/React.createElement(Input, {
    placeholder: "Pr\xE9nom Nom",
    autoFocus: true
  })), /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, {
    required: true
  }, "Courriel"), /*#__PURE__*/React.createElement(Input, {
    type: "email",
    placeholder: "prenom@exemple.com"
  })), /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, null, "Profession"), /*#__PURE__*/React.createElement(Select, {
    placeholder: "Choisir une profession",
    options: ['Psychologue', 'Psychothérapeute', 'Travailleur social', 'Sexologue', 'Psychoéducateur', 'Nutritionniste', "Conseiller d'orientation"]
  })), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Envoyer l'invitation maintenant",
    defaultChecked: true
  }))), toast && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      right: 20,
      bottom: 20,
      zIndex: 60
    }
  }, /*#__PURE__*/React.createElement(Toast, {
    variant: "success",
    title: toast,
    onDismiss: () => setToast(null)
  })));
}
function Fiche({
  pro,
  role,
  back
}) {
  const {
    Card,
    Badge,
    Avatar,
    Button,
    Icon,
    NavTabs,
    PageHeader,
    StatusIndicator,
    DropdownMenu,
    Input,
    Label,
    Select
  } = DS;
  const tabs = [{
    id: 'apercu',
    label: 'Aperçu'
  }, {
    id: 'profil',
    label: 'Profil'
  }, {
    id: 'public',
    label: 'Profil public'
  }, {
    id: 'documents',
    label: 'Documents',
    count: pro.docs
  }, {
    id: 'contrats',
    label: 'Contrats'
  }];
  if (role === 'admin') tabs.push({
    id: 'remu',
    label: 'Rémunération et fiscalité'
  });
  tabs.push({
    id: 'courriels',
    label: 'Courriels'
  }, {
    id: 'historique',
    label: 'Historique'
  });
  const [tab, setTab] = React.useState('apercu');
  const docs = [{
    n: 'Assurance responsabilité professionnelle',
    e: pro.expiry || '—',
    s: pro.expiring ? 'warning' : pro.status === 'active' ? 'complete' : 'pending'
  }, {
    n: 'Permis ' + pro.order,
    e: '31 mars 2027',
    s: pro.docs >= 2 ? 'complete' : 'pending'
  }, {
    n: 'Contrat de services',
    e: 'Signé le 12 janv. 2026',
    s: pro.docs >= 3 ? 'complete' : 'pending'
  }];
  const Kv = ({
    k,
    v
  }) => /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 12,
      padding: '6px 0',
      borderBottom: '1px solid var(--border)',
      font: 'var(--type-body)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-secondary)'
    }
  }, k), /*#__PURE__*/React.createElement("span", {
    className: "kit-num",
    style: {
      fontWeight: 500,
      whiteSpace: 'nowrap'
    }
  }, v));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: pro.name,
    size: "lg"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "kit-row"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: 'var(--type-page-title)',
      letterSpacing: 'var(--tracking-tight)'
    }
  }, pro.name), /*#__PURE__*/React.createElement(Badge, {
    variant: STATUS[pro.status][0]
  }, STATUS[pro.status][1])), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      font: 'var(--type-body)',
      color: 'var(--text-secondary)'
    }
  }, pro.profession, " \xB7 ", pro.order, " ", pro.licence, " \xB7 ", pro.email)), /*#__PURE__*/React.createElement("div", {
    className: "kit-row",
    style: {
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(DropdownMenu, {
    trigger: /*#__PURE__*/React.createElement(Button, {
      variant: "outline",
      size: "icon",
      "aria-label": "Actions"
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "ellipsis",
      size: 14
    })),
    items: [{
      label: 'Modifier le profil',
      icon: 'pencil'
    }, {
      label: 'Renvoyer l\'invitation',
      icon: 'send'
    }, '-', {
      label: pro.status === 'inactive' ? 'Réactiver' : 'Désactiver',
      icon: 'user-x',
      tone: pro.status === 'inactive' ? undefined : 'danger'
    }]
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "outline"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "file-text",
    size: 14
  }), " Fiche PDF"), /*#__PURE__*/React.createElement(Button, null, /*#__PURE__*/React.createElement(Icon, {
    name: "send",
    size: 14
  }), " Envoyer au client"))), /*#__PURE__*/React.createElement(NavTabs, {
    tabs: tabs,
    value: tab,
    onChange: setTab
  }), tab === 'apercu' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,2fr) minmax(240px,1fr)',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "Liste de v\xE9rification",
    description: "Invitation \u2192 questionnaire \u2192 documents \u2192 r\xE9vision \u2192 contrat \u2192 activation"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(StatusIndicator, {
    status: "complete",
    label: "Invitation accept\xE9e",
    description: "12 d\xE9c. 2025"
  }), /*#__PURE__*/React.createElement(StatusIndicator, {
    status: "complete",
    label: "Questionnaire compl\xE9t\xE9",
    description: "professions, ordre, permis, sp\xE9cialit\xE9s"
  }), /*#__PURE__*/React.createElement(StatusIndicator, {
    status: docs[0].s,
    label: docs[0].n,
    description: pro.expiring ? 'expire le ' + pro.expiry + ' · renouvellement demandé' : 'valide jusqu\'au ' + docs[0].e
  }), /*#__PURE__*/React.createElement(StatusIndicator, {
    status: docs[2].s,
    label: "Contrat sign\xE9 (Documenso)",
    description: docs[2].e
  }), /*#__PURE__*/React.createElement(StatusIndicator, {
    status: pro.status === 'active' ? 'complete' : 'pending',
    label: "Profil activ\xE9",
    description: pro.status === 'active' ? 'visible dans les suggestions de jumelage' : 'en attente de révision',
    style: {
      borderBottom: 0
    }
  }))), /*#__PURE__*/React.createElement("div", {
    className: "kit-col",
    style: {
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "Prochaine action"
  }, pro.expiring ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-body)',
      color: 'var(--text-secondary)'
    }
  }, "Relancer pour la preuve d'assurance renouvel\xE9e avant le ", pro.expiry, "."), /*#__PURE__*/React.createElement(Button, {
    style: {
      marginTop: 12
    },
    size: "sm"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "mail",
    size: 14
  }), " Envoyer un rappel")) : /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-body)',
      color: 'var(--text-secondary)'
    }
  }, "Rien \xE0 faire. Le dossier est complet.")), /*#__PURE__*/React.createElement(Card, {
    title: "Tarifs",
    description: "Fiche d'honoraires \xB7 annexe A"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Kv, {
    k: "Individuel \xB7 50 min",
    v: pro.rate + ',00 $'
  }), /*#__PURE__*/React.createElement(Kv, {
    k: "Couple / famille \xB7 60 min",
    v: pro.rate + 20 + ',00 $'
  }), /*#__PURE__*/React.createElement(Kv, {
    k: "Marge clinique",
    v: "28 %"
  }))))), tab === 'documents' && /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, /*#__PURE__*/React.createElement(Head, {
    cols: "2fr 1fr 1fr 32px"
  }, /*#__PURE__*/React.createElement("span", null, "Document"), /*#__PURE__*/React.createElement("span", null, "Expiration"), /*#__PURE__*/React.createElement("span", null, "Statut"), /*#__PURE__*/React.createElement("span", null)), docs.map(d => /*#__PURE__*/React.createElement(Row, {
    key: d.n,
    cols: "2fr 1fr 1fr 32px",
    style: {
      borderTop: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "kit-row"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "file-text",
    size: 14,
    style: {
      color: 'var(--text-muted)'
    }
  }), d.n), /*#__PURE__*/React.createElement("span", {
    className: "kit-num"
  }, d.e), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(Badge, {
    variant: d.s === 'complete' ? 'success' : d.s === 'warning' ? 'error' : 'outline'
  }, d.s === 'complete' ? 'Valide' : d.s === 'warning' ? 'Expire bientôt' : 'Manquant')), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "icon-sm",
    "aria-label": "T\xE9l\xE9charger"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "download",
    size: 14
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 12,
      borderTop: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "sm"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "upload",
    size: 14
  }), " T\xE9l\xE9verser un document"))), tab === 'profil' && /*#__PURE__*/React.createElement(Card, {
    title: "Identit\xE9 et profession",
    style: {
      maxWidth: 'var(--form-max)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, null, "Pr\xE9nom"), /*#__PURE__*/React.createElement(Input, {
    defaultValue: pro.name.split(' ')[0]
  })), /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, null, "Nom"), /*#__PURE__*/React.createElement(Input, {
    defaultValue: pro.name.split(' ').slice(1).join(' ')
  })), /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, null, "Profession"), /*#__PURE__*/React.createElement(Select, {
    defaultValue: pro.profession,
    options: ['Psychologue', 'Psychothérapeute', 'Travailleur social', 'Sexologue', 'Psychoéducateur', 'Nutritionniste']
  })), /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, null, "Ordre professionnel"), /*#__PURE__*/React.createElement(Input, {
    defaultValue: pro.order
  })), /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, null, "N\xB0 de permis"), /*#__PURE__*/React.createElement(Input, {
    defaultValue: pro.licence
  })), /*#__PURE__*/React.createElement("div", {
    className: "kit-col"
  }, /*#__PURE__*/React.createElement(Label, null, "Courriel"), /*#__PURE__*/React.createElement(Input, {
    defaultValue: pro.email
  }))), /*#__PURE__*/React.createElement("div", {
    className: "kit-row",
    style: {
      marginTop: 16,
      justifyContent: 'flex-end',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "outline"
  }, "Annuler"), /*#__PURE__*/React.createElement(Button, null, "Enregistrer"))), !['apercu', 'documents', 'profil'].includes(tab) && /*#__PURE__*/React.createElement(DS.FullPageMessage, {
    compact: true,
    title: tabs.find(t => t.id === tab).label,
    body: "Cette section sera disponible avec le module Professionnels (phase 4)."
  }));
}
Object.assign(window, {
  Professionnels,
  Fiche
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/clinique-mana-app/Professionnels.jsx", error: String((e && e.message) || e) }); }

// ui_kits/clinique-mana-app/Shell.jsx
try { (() => {
const {
  SidebarNav,
  Topbar,
  Dialog,
  CommandPalette,
  Icon
} = DS;
function Shell({
  role,
  setRole,
  page,
  setPage,
  title,
  crumbs,
  children
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [palette, setPalette] = React.useState(false);
  React.useEffect(() => {
    const h = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(p => !p);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const r = ROLES[role];
  const items = r.nav.map(id => ({
    id,
    ...NAV[id]
  }));
  const current = r.nav.includes(page) ? page : 'accueil';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: '100%',
      background: 'var(--bg)'
    }
  }, /*#__PURE__*/React.createElement(SidebarNav, {
    logoSrc: "../../assets/logo-header.svg",
    items: items,
    active: current,
    onNavigate: setPage,
    user: r.user,
    roleLabel: r.label,
    collapsed: collapsed,
    onSignOut: () => setPage('login')
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement(Topbar, {
    title: title,
    crumbs: crumbs,
    onToggleSidebar: () => setCollapsed(c => !c),
    onSearch: () => setPalette(true),
    notifications: role === 'conseillere' ? 3 : 1,
    user: r.user,
    actions: /*#__PURE__*/React.createElement(RoleSwitch, {
      role: role,
      setRole: setRole
    })
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: 'var(--page-pad)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--content-max)',
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, children))), palette && /*#__PURE__*/React.createElement(Dialog, {
    open: true,
    onClose: () => setPalette(false),
    hideClose: true,
    maxWidth: 600,
    style: {
      padding: 0,
      background: 'transparent',
      boxShadow: 'none'
    }
  }, /*#__PURE__*/React.createElement(CommandPalette, {
    onSelect: it => {
      setPalette(false);
      if (it.page) setPage(it.page);
    },
    groups: [{
      label: 'Clients',
      items: [{
        label: 'Marie Tremblay',
        icon: 'circle-user',
        hint: 'Cliente',
        page: 'clients'
      }, {
        label: 'Olivier Bernier',
        icon: 'circle-user',
        hint: 'Client',
        page: 'clients'
      }]
    }, {
      label: 'Professionnels',
      items: PROS.slice(0, 3).map(p => ({
        label: p.name,
        icon: 'users',
        hint: p.profession,
        page: 'professionnels'
      }))
    }, {
      label: 'Pages',
      items: r.nav.map(i => ({
        label: NAV[i].label,
        icon: NAV[i].icon,
        page: i
      }))
    }]
  })));
}
function RoleSwitch({
  role,
  setRole
}) {
  return /*#__PURE__*/React.createElement("div", {
    role: "radiogroup",
    "aria-label": "Voir comme",
    style: {
      display: 'flex',
      gap: 1,
      padding: 2,
      background: 'var(--bg-secondary)',
      borderRadius: 'var(--radius-md)',
      marginRight: 6
    }
  }, Object.entries(ROLES).map(([k, v]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    type: "button",
    role: "radio",
    "aria-checked": k === role,
    onClick: () => setRole(k),
    style: {
      border: 0,
      cursor: 'pointer',
      padding: '3px 8px',
      borderRadius: 4,
      font: 'var(--type-caption)',
      fontWeight: 500,
      background: k === role ? 'var(--surface-card)' : 'transparent',
      color: k === role ? 'var(--text-body)' : 'var(--text-muted)',
      boxShadow: k === role ? '0 0 0 1px var(--border)' : 'none',
      whiteSpace: 'nowrap'
    }
  }, v.label.split(' ')[0])));
}
/* Inline figure: label over number, separated by hairlines inside one flat panel */
function Figure({
  label,
  value,
  hint,
  onClick,
  tone
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClick,
    className: "kit-fig",
    style: {
      flex: 1,
      minWidth: 140,
      background: 'transparent',
      textAlign: 'left',
      padding: '12px 16px',
      cursor: onClick ? 'pointer' : 'default',
      font: 'inherit',
      color: 'inherit'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--type-caption)',
      color: 'var(--text-secondary)'
    }
  }, label), /*#__PURE__*/React.createElement("p", {
    className: "kit-num",
    style: {
      margin: '2px 0 0',
      font: 'var(--type-figure)',
      color: tone === 'warn' ? 'var(--danger)' : 'var(--text-body)'
    }
  }, value), hint && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      font: 'var(--type-caption)',
      color: 'var(--text-muted)'
    }
  }, hint));
}
function Row({
  children,
  onClick,
  cols,
  style,
  className = ''
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: 'kit-tr ' + className,
    onClick: onClick,
    style: {
      gridTemplateColumns: cols,
      cursor: onClick ? 'pointer' : 'default',
      ...style
    }
  }, children);
}
function Head({
  children,
  cols
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "kit-th",
    style: {
      gridTemplateColumns: cols
    }
  }, children);
}
Object.assign(window, {
  Shell,
  Figure,
  Row,
  Head
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/clinique-mana-app/Shell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/clinique-mana-app/data.jsx
try { (() => {
const DS = window.CliniqueMANADesignSystem_d475f9;
const ROLES = {
  admin: {
    label: 'Admin',
    user: 'Christine Sirois',
    nav: ['accueil', 'demandes', 'clients', 'professionnels', 'rendez-vous', 'facturation', 'parametres']
  },
  conseillere: {
    label: 'Conseillère',
    user: 'Alicia Gagnon',
    nav: ['accueil', 'demandes', 'clients', 'professionnels', 'rendez-vous']
  },
  adjointe: {
    label: 'Adjointe administrative',
    user: 'Rachel Bédard',
    nav: ['accueil', 'clients', 'professionnels', 'rendez-vous', 'facturation', 'parametres']
  }
};
const NAV = {
  accueil: {
    label: 'Accueil',
    icon: 'house'
  },
  demandes: {
    label: 'Demandes',
    icon: 'inbox',
    badge: 4
  },
  clients: {
    label: 'Clients',
    icon: 'circle-user'
  },
  professionnels: {
    label: 'Professionnels',
    icon: 'users'
  },
  'rendez-vous': {
    label: 'Rendez-vous',
    icon: 'calendar-days'
  },
  facturation: {
    label: 'Facturation',
    icon: 'receipt'
  },
  parametres: {
    label: 'Paramètres',
    icon: 'settings'
  }
};
const PROS = [{
  id: 1,
  name: 'Justin Mantha',
  email: 'j.mantha@exemple.com',
  profession: 'Psychologue',
  order: 'OPQ',
  licence: '12345-67',
  status: 'active',
  specialties: 10,
  docs: 3,
  expiry: '1 mars 2027',
  rate: 160
}, {
  id: 2,
  name: 'Sophie Lavoie',
  email: 'sophie.lavoie@exemple.com',
  profession: 'Psychothérapeute',
  order: 'OPQ',
  licence: '8821-11',
  status: 'active',
  specialties: 8,
  docs: 3,
  expiry: '19 oct. 2026',
  rate: 144,
  expiring: true
}, {
  id: 3,
  name: 'Marc-Antoine Roy',
  email: 'ma.roy@exemple.com',
  profession: 'Travailleur social',
  order: 'OTSTCFQ',
  licence: 'ROYM-4410',
  status: 'invited',
  specialties: 0,
  docs: 1,
  pendingInvite: true,
  rate: 130
}, {
  id: 4,
  name: 'Nadia Bouchard',
  email: 'nadia.b@exemple.com',
  profession: 'Sexologue',
  order: 'OPSQ',
  licence: '2290',
  status: 'active',
  specialties: 6,
  docs: 3,
  expiry: '12 juin 2027',
  rate: 150
}, {
  id: 5,
  name: 'Émilie Fortin',
  email: 'emilie.fortin@exemple.com',
  profession: 'Nutritionniste',
  order: 'ODNQ',
  licence: '7741',
  status: 'pending',
  specialties: 3,
  docs: 2,
  rate: 120
}, {
  id: 6,
  name: 'Pierre-Luc Dubé',
  email: 'pl.dube@exemple.com',
  profession: 'Psychoéducateur',
  order: 'OPPQ',
  licence: '5531',
  status: 'inactive',
  specialties: 5,
  docs: 3,
  expiry: '2 sept. 2026',
  rate: 130
}];
const STATUS = {
  active: ['success', 'Actif'],
  invited: ['secondary', 'Invité'],
  pending: ['outline', 'En attente'],
  inactive: ['error', 'Inactif']
};
const DEMANDES = [{
  id: 'D-1042',
  client: 'Marie Tremblay',
  motifs: ['Anxiété', 'Stress au travail'],
  source: 'Google',
  age: '2 h',
  urgency: 'normal',
  status: 'À rappeler',
  phone: '418 555-0142',
  pref: 'Soirs, semaine',
  payer: 'PAE Desjardins'
}, {
  id: 'D-1041',
  client: 'Olivier Bernier',
  motifs: ['Couple'],
  source: 'Recommandation',
  age: '5 h',
  urgency: 'normal',
  status: 'À rappeler',
  phone: '581 555-0199',
  pref: 'Fins de semaine'
}, {
  id: 'D-1039',
  client: 'Camille Giroux',
  motifs: ['Deuil'],
  source: 'Employeur / PAE',
  age: '1 j',
  urgency: 'haute',
  status: 'Appel découverte fait',
  phone: '418 555-0177',
  pref: 'Jours',
  payer: 'IVAC'
}, {
  id: 'D-1037',
  client: 'Samuel Lachance',
  motifs: ['Orientation', 'Adolescent'],
  source: 'École ou organisme',
  age: '2 j',
  urgency: 'normal',
  status: 'Jumelage proposé',
  phone: '418 555-0120',
  pref: 'Après 16 h'
}];
const RDV = [{
  time: '09:00',
  client: 'Marie Tremblay',
  pro: 'Justin Mantha',
  type: 'Individuel · 50 min',
  mode: 'Vidéo'
}, {
  time: '10:30',
  client: 'Olivier et Jade Bernier',
  pro: 'Nadia Bouchard',
  type: 'Couple · 60 min',
  mode: 'Vidéo'
}, {
  time: '13:00',
  client: 'Camille Giroux',
  pro: 'Sophie Lavoie',
  type: 'Individuel · 50 min',
  mode: 'Téléphone'
}, {
  time: '15:30',
  client: 'Samuel Lachance',
  pro: 'Justin Mantha',
  type: 'Individuel · 50 min',
  mode: 'Vidéo'
}];
const SETTINGS_GROUPS = [{
  label: 'Clinique',
  items: [{
    id: 'identite',
    label: 'Identité légale',
    icon: 'building-2'
  }, {
    id: 'fiscalite',
    label: 'Fiscalité',
    icon: 'percent'
  }, {
    id: 'signataire',
    label: 'Signataire',
    icon: 'pen-line'
  }, {
    id: 'banque',
    label: 'Coordonnées bancaires',
    icon: 'landmark'
  }, {
    id: 'region',
    label: 'Région',
    icon: 'globe'
  }, {
    id: 'confidentialite',
    label: 'Confidentialité (Loi 25)',
    icon: 'shield-check'
  }]
}, {
  label: 'Plateforme',
  items: [{
    id: 'utilisateurs',
    label: 'Utilisateurs et accès',
    icon: 'users'
  }, {
    id: 'modules',
    label: 'Modules',
    icon: 'blocks'
  }, {
    id: 'courriels',
    label: 'Courriels',
    icon: 'mail'
  }, {
    id: 'signature',
    label: 'Signature électronique',
    icon: 'signature'
  }, {
    id: 'integrations',
    label: 'Intégrations',
    icon: 'plug'
  }, {
    id: 'taches',
    label: 'Tâches planifiées',
    icon: 'clock'
  }, {
    id: 'audit',
    label: "Journal d'audit",
    icon: 'scroll-text'
  }]
}, {
  label: 'Modules',
  items: [{
    id: 'm-pros',
    label: 'Professionnels',
    icon: 'users'
  }, {
    id: 'm-services',
    label: 'Services et tarifs',
    icon: 'tag'
  }, {
    id: 'm-fact',
    label: 'Facturation',
    icon: 'receipt'
  }, {
    id: 'm-payeurs',
    label: 'Payeurs externes',
    icon: 'hand-coins'
  }, {
    id: 'm-rdv',
    label: 'Rendez-vous',
    icon: 'calendar-days'
  }]
}, {
  label: 'Mon compte',
  items: [{
    id: 'compte',
    label: 'Mon compte',
    icon: 'circle-user'
  }]
}];
const MODULES = [{
  key: 'professionals',
  name: 'Professionnels',
  enabled: true,
  depends: []
}, {
  key: 'services',
  name: 'Services et tarifs',
  enabled: true,
  depends: ['Professionnels']
}, {
  key: 'clients',
  name: 'Clients',
  enabled: true,
  depends: []
}, {
  key: 'requests',
  name: 'Demandes et jumelage',
  enabled: true,
  depends: ['Clients', 'Professionnels']
}, {
  key: 'appointments',
  name: 'Rendez-vous',
  enabled: false,
  depends: ['Clients', 'Professionnels']
}, {
  key: 'billing',
  name: 'Facturation',
  enabled: false,
  depends: ['Rendez-vous', 'Services et tarifs']
}];
Object.assign(window, {
  DS,
  ROLES,
  NAV,
  PROS,
  STATUS,
  DEMANDES,
  RDV,
  SETTINGS_GROUPS,
  MODULES
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/clinique-mana-app/data.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Alert = __ds_scope.Alert;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.Skeleton = __ds_scope.Skeleton;

__ds_ns.StarToggle = __ds_scope.StarToggle;

__ds_ns.StatusIndicator = __ds_scope.StatusIndicator;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Label = __ds_scope.Label;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.AuthCard = __ds_scope.AuthCard;

__ds_ns.FullPageMessage = __ds_scope.FullPageMessage;

__ds_ns.Accordion = __ds_scope.Accordion;

__ds_ns.CommandPalette = __ds_scope.CommandPalette;

__ds_ns.DropdownMenu = __ds_scope.DropdownMenu;

__ds_ns.NavTabs = __ds_scope.NavTabs;

__ds_ns.PageHeader = __ds_scope.PageHeader;

__ds_ns.SettingsNav = __ds_scope.SettingsNav;

__ds_ns.SidebarNav = __ds_scope.SidebarNav;

__ds_ns.Topbar = __ds_scope.Topbar;

__ds_ns.AlertDialog = __ds_scope.AlertDialog;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Popover = __ds_scope.Popover;

__ds_ns.Sheet = __ds_scope.Sheet;

__ds_ns.Toast = __ds_scope.Toast;

})();
