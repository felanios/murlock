local key = KEYS[1]
local clientId = ARGV[1]
local releaseTime = ARGV[2]

if redis.call("get", key) == clientId then
  return redis.call("pexpire", key, releaseTime)
else
  return 0
end
