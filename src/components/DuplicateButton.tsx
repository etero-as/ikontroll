import React from 'react';

interface DuplicateButtonProps {
  onClick: () => void;
  className?: string;
  disabled?: boolean;
  children?: React.ReactNode;
  ariaLabel?: string;
  type?: 'button' | 'submit' | 'reset';
}

const DuplicateButton: React.FC<DuplicateButtonProps> = ({
  onClick,
  className = '',
  disabled = false,
  children = 'Dupliser',
  ariaLabel,
  type = 'button',
}) => (
  <button
    type={type}
    onClick={onClick}
    className={`cursor-pointer rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 ${className}`}
    disabled={disabled}
    aria-label={ariaLabel}
  >
    {children}
  </button>
);

export default DuplicateButton;

