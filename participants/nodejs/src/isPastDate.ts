export const isPastDate = (date: Date): boolean => {
  return date < new Date();
};
