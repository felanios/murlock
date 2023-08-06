local key = KEYS[1]
local clientId = ARGV[1]
local releaseTime = ARGV[2]

if redis.call("get",key) == clientId or redis.call("set", key, clientId, "NX", "PX", releaseTime) then
  return 1
else
  return 0
end