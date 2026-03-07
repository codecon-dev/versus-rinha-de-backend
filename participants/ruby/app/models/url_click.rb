class UrlClick < ApplicationRecord
  belongs_to :short_url, class_name: "ShortUrl", foreign_key: "url_id"
end