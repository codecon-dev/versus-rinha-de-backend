class AddUniqueIndexToUrlsUrl < ActiveRecord::Migration[7.1]
  def up
    # Remove duplicate URLs (keep row with smallest id per url). Delete dependent clicks first.
    execute <<-SQL.squish
      DELETE FROM url_clicks
      WHERE url_id IN (
        SELECT a.id FROM urls a
        INNER JOIN urls b ON b.url = a.url AND b.id < a.id
      )
    SQL
    execute <<-SQL.squish
      DELETE FROM urls a
      USING urls b
      WHERE a.url = b.url AND a.id > b.id
    SQL
    add_index :urls, :url, unique: true
  end

  def down
    remove_index :urls, :url, unique: true
  end
end
