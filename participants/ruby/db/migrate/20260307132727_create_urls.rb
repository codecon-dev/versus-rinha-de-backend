class CreateUrls < ActiveRecord::Migration[7.1]
  def change
    create_table :urls do |t|
      t.string :code
      t.string :url
      t.string :short_url
      t.datetime :expires_at
      t.integer :click_count

      t.timestamps
    end
  end
end
