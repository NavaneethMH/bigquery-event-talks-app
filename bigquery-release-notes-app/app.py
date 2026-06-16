import os
import time
import re
import requests
import xml.etree.ElementTree as ET
from flask import Flask, jsonify, render_template, request

app = Flask(__name__, template_folder='templates', static_folder='static')

# Simple in-memory cache for the default feeds
# Stores: (fetched_url, entries_data, fallback_used, timestamp)
_cache = {}
CACHE_EXPIRY_SECONDS = 300  # 5 minutes

def parse_feed_content(xml_data):
    """Parses Atom XML feed data and returns a structured list of entries."""
    root = ET.fromstring(xml_data)
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    
    entries_data = []
    
    for entry in root.findall("atom:entry", ns):
        title_el = entry.find("atom:title", ns)
        updated_el = entry.find("atom:updated", ns)
        id_el = entry.find("atom:id", ns)
        content_el = entry.find("atom:content", ns)
        
        title = title_el.text if title_el is not None else "Unknown Date"
        updated = updated_el.text if updated_el is not None else ""
        entry_id = id_el.text if id_el is not None else ""
        content_html = content_el.text if content_el is not None else ""
        
        # Split content_html by <h3> tags to extract individual update items
        parts = re.split(r'(?i)<h3>(.*?)</h3>', content_html)
        
        items = []
        if len(parts) > 1:
            for i in range(1, len(parts), 2):
                category = parts[i].strip()
                item_content = parts[i+1] if i+1 < len(parts) else ""
                items.append({
                    "category": category,
                    "content": item_content.strip()
                })
        else:
            items.append({
                "category": "Update",
                "content": content_html.strip()
            })
            
        entries_data.append({
            "date": title,
            "updated": updated,
            "id": entry_id,
            "items": items
        })
        
    return entries_data

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/notes')
def get_notes():
    custom_url = request.args.get('url')
    force_refresh = request.args.get('refresh', '').lower() == 'true'
    
    # Target URLs
    default_url = "https://docs.cloud.google.com/feeds/bigquery-release-notes.xml"
    fallback_url = "https://cloud.google.com/feeds/bigquery-release-notes.xml"
    
    url_to_fetch = custom_url if custom_url else default_url
    
    # Check cache first if it's the default URL and not force refresh
    cache_key = url_to_fetch
    now = time.time()
    if not force_refresh and cache_key in _cache:
        cached_data, timestamp = _cache[cache_key]
        if now - timestamp < CACHE_EXPIRY_SECONDS:
            return jsonify({
                "cached": True,
                "expires_in_seconds": int(CACHE_EXPIRY_SECONDS - (now - timestamp)),
                **cached_data
            })
            
    # Fetch data
    fetched_url = url_to_fetch
    fallback_used = False
    xml_data = None
    error_log = []
    
    try:
        # First attempt
        r = requests.get(url_to_fetch, timeout=10)
        if r.status_code == 200:
            xml_data = r.content
        else:
            error_log.append(f"HTTP {r.status_code} from {url_to_fetch}")
    except Exception as e:
        error_log.append(f"Error connecting to {url_to_fetch}: {str(e)}")
        
    # Fallback attempt if default failed and no custom URL was requested
    if xml_data is None and not custom_url:
        try:
            r = requests.get(fallback_url, timeout=10)
            if r.status_code == 200:
                xml_data = r.content
                fetched_url = fallback_url
                fallback_used = True
            else:
                error_log.append(f"HTTP {r.status_code} from fallback {fallback_url}")
        except Exception as e:
            error_log.append(f"Error connecting to fallback {fallback_url}: {str(e)}")
            
    if xml_data is None:
        return jsonify({
            "success": False,
            "error": "Failed to fetch release notes feed from target URLs.",
            "details": error_log
        }), 502
        
    try:
        entries = parse_feed_content(xml_data)
        response_data = {
            "success": True,
            "fetched_url": fetched_url,
            "fallback_used": fallback_used,
            "entries": entries,
            "timestamp": now
        }
        
        # Cache the result
        _cache[cache_key] = (response_data, now)
        
        return jsonify({
            "cached": False,
            **response_data
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Failed to parse XML content: {str(e)}"
        }), 500

if __name__ == '__main__':
    # Get port from environment or default to 5000
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
