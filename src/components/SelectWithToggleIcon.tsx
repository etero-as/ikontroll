'use client';

import { forwardRef, useState, type KeyboardEvent, type SelectHTMLAttributes } from 'react';

type SelectWithToggleIconProps = SelectHTMLAttributes<HTMLSelectElement> & {
  wrapperClassName?: string;
};

const SelectWithToggleIcon = forwardRef<HTMLSelectElement, SelectWithToggleIconProps>(
  (
    {
      className,
      wrapperClassName,
      children,
      onBlur,
      onFocus,
      onChange,
      onMouseDown,
      onTouchStart,
      onKeyDown,
      disabled,
      ...rest
    },
    ref,
  ) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isFocused, setIsFocused] = useState(false);

    const handleMouseDown: SelectWithToggleIconProps['onMouseDown'] = (event) => {
      onMouseDown?.(event);
      if (!event.defaultPrevented && !disabled) {
        setIsOpen(isFocused ? !isOpen : true);
      }
    };

    const handleTouchStart: SelectWithToggleIconProps['onTouchStart'] = (event) => {
      onTouchStart?.(event);
      if (!event.defaultPrevented && !disabled) {
        setIsOpen(isFocused ? !isOpen : true);
      }
    };

    const handleBlur: SelectWithToggleIconProps['onBlur'] = (event) => {
      setIsFocused(false);
      setIsOpen(false);
      onBlur?.(event);
    };

    const handleFocus: SelectWithToggleIconProps['onFocus'] = (event) => {
      setIsFocused(true);
      onFocus?.(event);
    };

    const handleChange: SelectWithToggleIconProps['onChange'] = (event) => {
      setIsOpen(false);
      onChange?.(event);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLSelectElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || disabled) {
        return;
      }
      if (event.key === 'Escape' || event.key === 'Tab') {
        setIsOpen(false);
        return;
      }
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === ' ' ||
        event.key === 'Enter'
      ) {
        setIsOpen(true);
      }
    };

    return (
      <div className={`relative inline-flex items-center ${wrapperClassName ?? ''}`}>
        <select
          {...rest}
          ref={ref}
          disabled={disabled}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onBlur={handleBlur}
          onFocus={handleFocus}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={`relative z-0 appearance-none pr-9 ${className ?? ''}`}
        >
          {children}
        </select>
        <span
          className="pointer-events-none absolute inset-y-0 right-3 z-20 flex items-center text-slate-700"
          aria-hidden="true"
        >
          {isOpen ? (
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path
                fillRule="evenodd"
                d="M14.78 11.78a.75.75 0 0 1-1.06 0L10 8.06l-3.72 3.72a.75.75 0 1 1-1.06-1.06l4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06Z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path
                fillRule="evenodd"
                d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </span>
      </div>
    );
  },
);

SelectWithToggleIcon.displayName = 'SelectWithToggleIcon';

export default SelectWithToggleIcon;
