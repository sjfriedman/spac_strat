import React from 'react';
import { resetAll } from '../utils/storage';

interface ResetButtonProps {
  onReset: () => void;
}

export default function ResetButton({ onReset }: ResetButtonProps) {
  const handleReset = () => {
    if (window.confirm('Are you sure you want to reset all favorites and locked positions? This cannot be undone.')) {
      resetAll();
      onReset();
      alert('All favorites and locked positions have been reset!');
    }
  };

  return (
    <button
      onClick={handleReset}
      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm font-medium"
      title="Reset all favorites and locked positions"
    >
      Reset All
    </button>
  );
}

