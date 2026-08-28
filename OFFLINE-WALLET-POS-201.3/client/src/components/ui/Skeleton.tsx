import React from 'react';

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <div className={`animate-pulse bg-gray-200 rounded ${className}`}></div>
  );
};

export const TableSkeleton: React.FC<{ rows?: number; columns?: number }> = ({ rows = 5, columns = 4 }) => {
  return (
    <div className="w-full">
      <div className="flex space-x-4 mb-4">
        {[...Array(columns)].map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-8 w-1/4" />
        ))}
      </div>
      <div className="space-y-3">
        {[...Array(rows)].map((_, i) => (
          <div key={`r-${i}`} className="flex space-x-4">
            {[...Array(columns)].map((_, j) => (
              <Skeleton key={`c-${i}-${j}`} className="h-6 w-1/4" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export const CardSkeleton: React.FC = () => {
  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
      <div className="flex justify-between items-start mb-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
      <Skeleton className="h-8 w-1/2 mb-2" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
};
