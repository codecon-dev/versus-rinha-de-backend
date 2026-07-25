import secrets
import string
import qrcode
from io import BytesIO
import base64


def valid_url(url):
    if url is None:
        return True

    # Converte para minúsculo para garantir a verificação
    url = url.strip().lower()
    if url.startswith(('http://', 'https://')):
        return True
    return False


def generate_random_code():
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(16))


def generate_qrcode_base64(data):
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )
    qr.add_data(data)
    qr.make(fit=True)

    # Generate image
    # The 'qrcode[pil]' installation enables the use of make_image()
    img = qr.make_image(fill_color="black", back_color="white")

    # Save the image to a BytesIO object (in-memory file)
    buffer = BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0) # Rewind the buffer to the beginning

    # Read the bytes and encode to Base64
    img_bytes = buffer.read()
    b64_encoded_bytes = base64.b64encode(img_bytes)

    # Decode bytes to a UTF-8 string for display or use in HTML
    b64_encoded_string = b64_encoded_bytes.decode('utf-8')

    # Return the data URL format which can be used directly in HTML
    return f"{b64_encoded_string}"