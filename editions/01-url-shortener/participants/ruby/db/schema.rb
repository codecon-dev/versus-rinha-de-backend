# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[7.1].define(version: 2026_03_07_152244) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "plpgsql"

  create_table "url_clicks", force: :cascade do |t|
    t.bigint "url_id", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["created_at"], name: "index_url_clicks_on_created_at"
    t.index ["url_id"], name: "index_url_clicks_on_url_id"
  end

  create_table "urls", force: :cascade do |t|
    t.string "code"
    t.string "url"
    t.string "short_url"
    t.datetime "expires_at"
    t.integer "click_count"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["code"], name: "index_urls_on_code", unique: true
    t.index ["url"], name: "index_urls_on_url", unique: true
  end

  add_foreign_key "url_clicks", "urls"
end
