/**
 * Reset Button Component
 * Provides reset functionality for sections
 */

import React, { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ResetButtonProps {
  sectionName: string;
  onReset: () => void;
  description?: string;
}

export function ResetButton({ sectionName, onReset, description }: ResetButtonProps) {
  const [showDialog, setShowDialog] = useState(false);

  const handleReset = () => {
    onReset();
    setShowDialog(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setShowDialog(true)}
        className="flex items-center justify-center h-7 px-3 rounded-t bg-red-600 hover:bg-red-700 text-white transition-colors border-t border-l border-r border-red-500 shadow-sm"
        title={`Reset ${sectionName}`}
      >
        <RotateCcw className="w-4 h-4" />
      </button>

      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent className="bg-popover border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Reset {sectionName}?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {description || `This will clear all data in the ${sectionName} section. This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-muted text-foreground hover:bg-muted/80">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleReset}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Reset Section
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
