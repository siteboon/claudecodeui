import type { RefObject } from 'react';

type ShellMinimalViewProps = {
  terminalContainerRef: RefObject<HTMLDivElement>;
};

export default function ShellMinimalView({
  terminalContainerRef,
}: ShellMinimalViewProps) {
  return (
    <div className="relative h-full w-full bg-gray-900">
      <div
        ref={terminalContainerRef}
        className="h-full w-full focus:outline-none"
        style={{ outline: 'none' }}
      />
    </div>
  );
}
