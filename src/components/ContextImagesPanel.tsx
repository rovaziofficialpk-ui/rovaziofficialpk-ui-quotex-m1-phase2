import type { ChangeEvent } from 'react';
import type { ContextLabel } from '../services/groq';

interface ContextImagesPanelProps {
  images: Record<ContextLabel, string | null>;
  onUpload: (label: ContextLabel, event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: (label: ContextLabel) => void;
}

export function ContextImagesPanel({ images, onUpload, onRemove }: ContextImagesPanelProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(['M5', 'H1'] as ContextLabel[]).map((label) => (
        <div key={label} className="rounded-md border border-slate-800 bg-slate-950/50 p-1.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[9px] font-black text-slate-400">{label}</span>
            {images[label] && <button onClick={() => onRemove(label)} className="text-[8px] text-red-400">×</button>}
          </div>
          {images[label] ? (
            <img src={images[label] || ''} alt={`${label} context`} className="h-12 w-full rounded object-cover" />
          ) : (
            <label className="flex h-12 cursor-pointer items-center justify-center rounded border border-dashed border-slate-700 text-[9px] text-slate-500 hover:border-blue-400">
              + {label}
              <input type="file" accept="image/*" className="hidden" onChange={(event: ChangeEvent<HTMLInputElement>) => onUpload(label, event)} />
            </label>
          )}
        </div>
      ))}
    </div>
  );
}
