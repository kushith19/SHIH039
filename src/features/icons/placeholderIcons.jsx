function makeIcon(pathD) {
  return function Icon(props) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        <path d={pathD} />
      </svg>
    )
  }
}

export const IoIosSpeedometer = makeIcon('M12 4a8 8 0 1 0 8 8');
export const IoMdCloud = makeIcon('M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11 3 3 3 0 0 0 1 5z');
export const IoMdPeople = makeIcon('M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2');
export const IoMdCash = makeIcon('M3 7h18v10H3zM7 7v10M17 7v10');
export const IoMdPower = makeIcon('M12 2v20M7 6l10 12M17 6L7 18');

