#!/usr/bin/env bash
mongo --eval "rs.status()" | grep '"ok" : 1'
if [[ $? -eq 0 ]]; then
    exit 0;
fi
echo "rs.status() is not okay"
exit 1