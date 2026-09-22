import React from 'react';
import { X } from 'lucide-react';

// Right-side slide-over used by every add/edit form.
export function Drawer({ title, onClose, onSave, saveLabel = 'Save', width, children }) {
  return (
    <>
      <div className="drawer-mask" onClick={onClose} />
      <div className="drawer" style={width ? { width } : undefined}>
        <div className="drawer-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="drawer-body">{children}</div>
        <div className="drawer-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn accent" onClick={onSave}>{saveLabel}</button>
        </div>
      </div>
    </>
  );
}

export function Field({ label, required, children }) {
  return (
    <div className="field">
      <label>{label}{required && <span style={{ color: '#fca5a5' }}> *</span>}</label>
      {children}
    </div>
  );
}

export function Switch({ checked, onChange }) {
  return (
    <button type="button" className={'switch' + (checked ? ' on' : '')} onClick={() => onChange(!checked)}>
      <span className="knob" />
    </button>
  );
}
