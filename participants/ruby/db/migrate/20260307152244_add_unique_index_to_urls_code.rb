class AddUniqueIndexToUrlsCode < ActiveRecord::Migration[7.1]
  def change
    add_index :urls, :code, unique: true
  end
end
