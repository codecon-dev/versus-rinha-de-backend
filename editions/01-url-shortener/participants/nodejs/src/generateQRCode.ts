import * as QRCode from "qrcode";

export const generateQrCode = async (dataToEncode: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    QRCode.toDataURL(dataToEncode, function (err, code) {
      if (err) {
        reject(err);
        return;
      }
      resolve(code);
    });
  });
};
