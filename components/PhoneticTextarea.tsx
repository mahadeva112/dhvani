import React from 'react';
import { PhoneticSmartTextarea } from './PhoneticSmartTextarea';

interface PhoneticTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  onChangeText: (value: string) => void;
  language: string;
  isPhoneticActive?: boolean;
  onOpenPhoneticModal?: () => void;
}

export const PhoneticTextarea: React.FC<PhoneticTextareaProps> = ({
  value,
  onChangeText,
  language,
  isPhoneticActive = true,
  onOpenPhoneticModal,
  className = '',
  rows = 2,
  placeholder,
  id,
}) => {
  return (
    <PhoneticSmartTextarea
      id={id}
      value={value}
      onChange={onChangeText}
      language={language}
      placeholder={placeholder}
      rows={rows}
      className={className}
      onOpenKeyboardModal={onOpenPhoneticModal}
    />
  );
};
