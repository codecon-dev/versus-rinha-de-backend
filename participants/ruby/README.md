rails new api-template --api


criar um recurso 
rails generate model Post title:string body:text
rails db:migrate

rails generate controller Posts

on routes
Rails.application.routes.draw do
  resources :posts
end


example

class PostsController < ApplicationController

  def index
    posts = Post.all
    render json: posts
  end

  def show
    post = Post.find(params[:id])
    render json: post
  end

  def create
    post = Post.create(post_params)
    render json: post, status: :created
  end

  private

  def post_params
    params.require(:post).permit(:title, :body)
  end
end


curl -X POST http://localhost:3000/posts \
-H "Content-Type: application/json" \
-d '{"post": {"title": "Hello", "body": "World"}}'


para adicionar autenticacao 
# app/controllers/application_controller.rb
class ApplicationController < ActionController::API
  before_action :authenticate_request

  private

  def authenticate_request
    token = request.headers["Authorization"]&.split(" ")&.last

    unless token == "meu_token_secreto"
      render json: { error: "Não autorizado" }, status: :unauthorized
    end
  end
end




curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"senha123"}'


  curl -i http://localhost:3000/posts