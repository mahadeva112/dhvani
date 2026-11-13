import React from 'react';
import { ArrowRight } from 'lucide-react';

/**
 * "From → to" between two values (a setting's old and new value, a language
 * pair, a subtitle's start and end): a small drawn arrow, not a typed → that
 * reads as plain text.
 */
export const FlowArrow: React.FC<{ className?: string }> = ({ className = '' }) => (
  <ArrowRight aria-hidden="true" strokeWidth={2.25} className={`inline-block w-3 h-3 shrink-0 align-[-1px] text-slate-500 ${className}`} />
);
