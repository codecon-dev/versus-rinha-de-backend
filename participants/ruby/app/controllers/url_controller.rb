class UrlController < ApplicationController
  wrap_parameters false

  def health
    render json: { status: "ok" }, status: 200
  end

  # Test helper: delete all URLs so test suite starts with clean DB (only in development/test)
  def reset
    ShortUrl.delete_all
    head :no_content
  end

  def index
    page = (params[:page] || 1).to_i
    per_page = [(params[:per_page] || 10).to_i, 100].min
    per_page = 10 if per_page < 1
    page = 1 if page < 1

    relation = ShortUrl.order(created_at: :desc)
    total = relation.count
    items = relation.offset((page - 1) * per_page).limit(per_page)

    data = items.map { |u| short_url_json(u) }
    render json: {
      data: data,
      meta: { page: page, per_page: per_page, total: total }
    }, status: :ok
  end

  def urls
    # Validations that must return 400
    raw_url = params[:url].to_s.strip
    return head :bad_request if raw_url.blank?

    original_url = normalize_url(raw_url)
    return head :bad_request unless valid_url?(original_url)

    custom_code = params[:custom_code].to_s.strip.presence
    return head :bad_request if custom_code && custom_code.length > 16

    if params[:expires_at].present?
      expires_at = Time.zone.parse(params[:expires_at]) rescue nil
      return head :bad_request if expires_at.nil? || expires_at <= Time.current
    end

    # Idempotency: same URL returns 200 with existing record
    existing = ShortUrl.find_by(url: original_url)
    if existing
      ensure_short_url(existing)
      # If caller explicitly asks for the same custom code that is already taken,
      # return conflict to satisfy duplicate custom_code semantics.
      return head :conflict if custom_code.present? && custom_code == existing.code
      return render json: short_url_json(existing), status: :ok
    end

    # Duplicate custom_code -> 409 (only after URL idempotency check)
    if custom_code.present? && ShortUrl.exists?(code: custom_code)
      return head :conflict
    end

    code = custom_code.presence || generate_code
    url = ShortUrl.new(
      url: original_url,
      code: code,
      click_count: 0,
      expires_at: params[:expires_at].present? ? Time.zone.parse(params[:expires_at]) : nil
    )
    ensure_short_url(url)

    if url.save
      render json: short_url_json(url), status: :created
    else
      if url.errors[:url].any?
        return head :bad_request
      end
      if url.errors[:code].any? && ShortUrl.exists?(code: code)
        return head :conflict
      end
      if url.errors[:expires_at].any?
        return head :bad_request
      end
      render json: { status: "error", errors: url.errors.full_messages }, status: :unprocessable_entity
    end
  rescue ActiveRecord::RecordNotUnique
    # Race: another request created same URL or same custom_code.
    # If URL now exists, idempotency wins and returns 200.
    existing = ShortUrl.find_by(url: original_url)
    if existing && !(custom_code.present? && custom_code == existing.code)
      ensure_short_url(existing)
      render json: short_url_json(existing), status: :ok
    elsif custom_code.present? && ShortUrl.exists?(code: custom_code)
      head :conflict
    else
      head :conflict
    end
  end

  def click_count
    url = ShortUrl.find_by!(code: params[:code])
    if url.expires_at.present? && url.expires_at <= Time.current
      return head :gone
    end
    ShortUrl.transaction do
      ShortUrl.where(id: url.id).update_all("click_count = COALESCE(click_count, 0) + 1")
      UrlClick.create!(url_id: url.id)
    end
    redirect_to url.url, allow_other_host: true, status: :moved_permanently
  end

  def url
    url = ShortUrl.find(params[:id])
    ensure_short_url(url)
    render json: short_url_json(url), status: :ok
  end

  def patch
    url = ShortUrl.find(params[:id])
    attrs = {}
    if params.key?(:url)
      raw_url = params[:url].to_s.strip
      return head :bad_request if raw_url.blank?

      normalized_url = normalize_url(raw_url)
      return head :bad_request unless valid_url?(normalized_url)

      attrs[:url] = normalized_url
    end
    if params.key?(:expires_at)
      if params[:expires_at].blank?
        attrs[:expires_at] = nil
      else
        t = Time.zone.parse(params[:expires_at]) rescue nil
        return head :bad_request if t.nil? || t <= Time.current
        attrs[:expires_at] = t
      end
    end
    if attrs.any? && url.update(attrs)
      ensure_short_url(url)
      render json: short_url_json(url), status: :ok
    else
      render json: { status: "error", errors: url.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def delete
    ShortUrl.find(params[:id]).destroy
    head :no_content
  end

  def stats
    url = ShortUrl.find(params[:id])
    clicks_per_day = url.url_clicks
      .group("DATE(created_at)")
      .count
      .map { |date, count| { date: date.to_s, count: count } }
    clicks_per_hour = url.url_clicks
      .group("DATE_TRUNC('hour', created_at)")
      .count
      .map { |hour, count| { hour: hour.utc.iso8601, count: count } }
    render json: {
      id: url.id,
      code: url.code,
      url: url.url,
      click_count: url.click_count || 0,
      clicks_per_day: clicks_per_day,
      clicks_per_hour: clicks_per_hour
    }, status: :ok
  end

  def qr_code
    require "rqrcode"
    require "base64"
    url = ShortUrl.find(params[:id])
    ensure_short_url(url)
    qr = RQRCode::QRCode.new(url.short_url)
    png = qr.as_png(size: 120, border_modules: 4)
    base64_str = Base64.strict_encode64(png.to_datastream.to_s)
    render json: { qr_code: base64_str }, content_type: "application/json"
  end

  private

  def short_url_json(u)
    {
      id: u.id,
      code: u.code,
      url: u.url,
      short_url: u.short_url,
      created_at: u.created_at,
      updated_at: u.updated_at,
      click_count: u.click_count || 0,
      expires_at: u.expires_at
    }
  end

  def ensure_short_url(record)
    return if record.short_url.present?
    full = "#{request.base_url}/#{record.code}"
    if record.persisted?
      record.update_column(:short_url, full)
    else
      record.short_url = full
    end
  end

  def url_params
    params.permit(:url, :expires_at)
  end

  def valid_url?(str)
    return false if str.blank?
    uri = URI.parse(str)
    return false unless (uri.is_a?(URI::HTTP) || uri.is_a?(URI::HTTPS)) && uri.host.present?
    # Reject bare hostnames like "not-a-url" (no dot, not localhost)
    return false unless uri.host.include?(".") || uri.host == "localhost"
    true
  rescue URI::InvalidURIError
    false
  end

  def generate_code
    loop do
      code = SecureRandom.alphanumeric(6)
      break code unless ShortUrl.exists?(code: code)
    end
  end

  def normalize_url(value)
    return nil if value.blank?
    value.match?(/\Ahttps?:\/\//i) ? value : "https://#{value}"
  end
end
