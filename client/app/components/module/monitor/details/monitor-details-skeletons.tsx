import { Skeleton } from "@/components/core";
import {
  SECTION_CLASS,
  SURFACE_TILE_CLASS,
} from "@/components/module/monitor/details/surface-styles";

export const LoadingListSkelton = ({ length }: { length: number }) => (
  <div className="grid w-full gap-2">
    {Array.from({ length: length }).map((_, index) => (
      <Skeleton key={index} className="h-12 w-full rounded-sm" />
    ))}
  </div>
);

export const MonitorCardSkeleton = () => {
  return (
    <div className={SECTION_CLASS}>
      <Skeleton className="h-4 w-44" />
      <div className={`${SURFACE_TILE_CLASS} grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2`}>
        {/* Deploys from */}
        <div>
          <div className="mb-1">
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        {/* URL to monitor */}
        <div>
          <div className="mb-1">
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-60" />
        </div>
        {/* Monitor type */}
        <div className="sm:col-span-2">
          <div className="mb-1">
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-32" />
        </div>
        {/* Notification recipients */}
      </div>
    </div>
  );
};

/** Mirrors the Response time section: heading and range select, three tiles, the chart card. */
export const ResponseSkeletonLoader = () => {
  return (
    <div className={SECTION_CLASS}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-9 w-40 rounded-sm" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-[116px] w-full rounded-sm" />
        ))}
      </div>
      <div className={SURFACE_TILE_CLASS}>
        <div className="mb-4 flex gap-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-[260px] w-full rounded-sm" />
      </div>
    </div>
  );
};
