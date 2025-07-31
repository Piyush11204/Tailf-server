if [ -z "$1" ]; then
    echo "Usage: $0 <filename>"
    exit 1
fi

FILE="uploads/$1"

if [ ! -f "$FILE" ]; then
    echo "File $FILE not found"
    exit 1
fi

echo "Adding test lines to $FILE every 2 seconds..."
echo "Press Ctrl+C to stop"

counter=1
while true; do
    echo "$(date '+%Y-%m-%d %H:%M:%S') INFO Test message $counter" >> "$FILE"
    echo "Added line $counter"
    counter=$((counter + 1))
    sleep 2
done
