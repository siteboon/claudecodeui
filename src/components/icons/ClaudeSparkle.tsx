import type { SVGProps } from 'react';

export default function ClaudeSparkle(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M12 2L14.09 8.26L20 10L14.09 11.74L12 18L9.91 11.74L4 10L9.91 8.26L12 2Z"
        fill="currentColor"
        opacity="0.9"
      />
      <path
        d="M18 14L19.18 17.12L22 18L19.18 18.88L18 22L16.82 18.88L14 18L16.82 17.12L18 14Z"
        fill="currentColor"
        opacity="0.6"
      />
      <path
        d="M5 16L5.82 18.18L8 19L5.82 19.82L5 22L4.18 19.82L2 19L4.18 18.18L5 16Z"
        fill="currentColor"
        opacity="0.4"
      />
    </svg>
  );
}
