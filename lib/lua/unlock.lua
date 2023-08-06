local key = KEYS[1]
local clientId = ARGV[1]

if redis.call("get", key) == clientId then
  return redis.call("del", key)
else
  return 0
end