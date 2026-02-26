require "sinatra/base"
require "json"

class App < Sinatra::Base
  set :port, ENV.fetch("PORT", 3000).to_i
  set :bind, "0.0.0.0"

  get "/health" do
    content_type :json
    { status: "ok" }.to_json
  end
end
