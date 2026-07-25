class ShortUrl < ApplicationRecord
  self.table_name = "urls"

  validates :url, presence: true
  validates :code, presence: true, uniqueness: true, length: { maximum: 16 }
  validate :url_format
  validate :expires_at_future, if: -> { expires_at.present? }
  has_many :url_clicks, class_name: "UrlClick", foreign_key: "url_id", dependent: :destroy

  private

  def url_format
    return if url.blank?
    uri = URI.parse(url)
    return if uri.is_a?(URI::HTTP) || uri.is_a?(URI::HTTPS)
    errors.add(:url, "must be a valid HTTP or HTTPS URL")
  rescue URI::InvalidURIError
    errors.add(:url, "must be a valid HTTP or HTTPS URL")
  end

  def expires_at_future
    return if expires_at.blank?
    errors.add(:expires_at, "must be in the future") if expires_at <= Time.current
  end
end
