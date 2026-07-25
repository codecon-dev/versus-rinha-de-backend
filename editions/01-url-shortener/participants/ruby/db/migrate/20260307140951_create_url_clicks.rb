class CreateUrlClicks < ActiveRecord::Migration[6.0]
  def change
    create_table :url_clicks do |t|
      t.references :url, null: false, foreign_key: true

      t.timestamps
    end

    add_index :url_clicks, :created_at
  end
end