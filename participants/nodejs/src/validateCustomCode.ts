export const validateCustomCode = (code: string): boolean => {
  return code.length <= 16;
};
