search Host show name, fqdn, os, os_version, ip_address, mac_address, cpu_count, ram, disk_total, serial_no, model, manufacturer, domain, virtual



search Host where _last_update_time > ago "7 days" show name, fqdn, os, os_version, ip_address, mac_address, cpu_count, ram, disk_total, serial_no, model, manufacturer, domain, virtual
