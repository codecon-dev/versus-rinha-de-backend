Rails.application.routes.draw do
  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  get "health" => "url#health"
  delete "urls" => "url#reset"
  get "urls" => "url#index"
  post "urls" => "url#urls"
  get "urls/:id" => "url#url"
  patch "urls/:id" => "url#patch"
  delete "urls/:id" => "url#delete"
  get ":code" => "url#click_count"
  get "urls/:id/stats" => "url#stats"
  get "urls/:id/qr" => "url#qr_code"

end
