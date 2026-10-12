// IT Support Portal - Windows registration agent.
//
// The backend compiles this file together with a generated AgentConfig.cs
// (portal URL + labels chosen in "Build Installer") using the C# compiler
// that ships with the .NET Framework 4.x. See /api/download-agent in main.py.
//
// What it does: shows the details it is about to send, asks for confirmation,
// and registers this computer once with the portal. It installs nothing and
// does not keep running afterwards.
//
// Usage:  ITPortalAgent_<Company>.exe        (asks before sending)
//         ITPortalAgent_<Company>.exe /y     (no prompts, for scripted rollout)

using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

[assembly: AssemblyTitle("IT Support Portal Agent")]
[assembly: AssemblyDescription("Registers this computer with the IT Support Portal")]
[assembly: AssemblyCompany("IT Support Portal")]
[assembly: AssemblyProduct("IT Support Portal Agent")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class Program
{
    private static int Main(string[] args)
    {
        bool unattended = HasFlag(args, "/y") || HasFlag(args, "--yes");

        string portalUrl = AgentConfig.PortalUrl.TrimEnd('/');
        string hostname = AgentConfig.CustomName.Length > 0 ? AgentConfig.CustomName : Environment.MachineName;
        string user = Environment.UserName;
        string ipAddress = GetLocalIPv4(portalUrl);
        string machineId = "WIN-" + GetStableMachineKey();

        try
        {
            Console.Title = "IT Support Portal Agent";
            Console.OutputEncoding = Encoding.UTF8;
        }
        catch (IOException) { }

        Console.WriteLine("IT Support Portal - Machine Registration");
        Console.WriteLine("=======================================");
        Console.WriteLine("Portal      : " + portalUrl);
        Console.WriteLine("Machine ID  : " + machineId);
        Console.WriteLine("Hostname    : " + hostname);
        Console.WriteLine("IP address  : " + ipAddress);
        Console.WriteLine("User        : " + user);
        Console.WriteLine("OS          : " + GetWindowsVersion());
        Console.WriteLine("Company     : " + AgentConfig.Company);
        Console.WriteLine("Site        : " + AgentConfig.Site);
        Console.WriteLine("Department  : " + AgentConfig.Department);
        Console.WriteLine("Device type : " + AgentConfig.DeviceType);
        Console.WriteLine();

        if (!unattended)
        {
            Console.Write("Register this computer with the portal? [Y/n] ");
            string answer = (Console.ReadLine() ?? "").Trim();
            if (answer.Length > 0 && !answer.StartsWith("y", StringComparison.OrdinalIgnoreCase))
            {
                Console.WriteLine("Cancelled. Nothing was sent.");
                WaitForEnter(unattended);
                return 2;
            }
        }

        StringBuilder payload = new StringBuilder("{");
        AppendField(payload, "machine_id", machineId, true);
        AppendField(payload, "hostname", hostname, false);
        AppendField(payload, "ip_address", ipAddress, false);
        AppendField(payload, "os_type", "Windows", false);
        AppendField(payload, "user", user, false);
        AppendField(payload, "status", "Online", false);
        AppendField(payload, "remote_url", "", false);
        AppendField(payload, "company", AgentConfig.Company, false);
        AppendField(payload, "site", AgentConfig.Site, false);
        AppendField(payload, "department", AgentConfig.Department, false);
        AppendField(payload, "device_type", AgentConfig.DeviceType, false);
        payload.Append("}");

        int exitCode;
        try
        {
            Console.WriteLine("Contacting the portal...");
            string response = PostJson(portalUrl + "/api/remote-machines/register", payload.ToString());
            Console.WriteLine("Registered successfully.");
            Console.WriteLine(response);
            exitCode = 0;
        }
        catch (WebException ex)
        {
            Console.WriteLine("Registration failed: " + ex.Message);
            string body = ReadErrorBody(ex);
            if (body.Length > 0) Console.WriteLine(body);
            Console.WriteLine("Check that " + portalUrl + " can be reached from this computer.");
            exitCode = 1;
        }
        catch (Exception ex)
        {
            Console.WriteLine("Registration failed: " + ex.Message);
            exitCode = 1;
        }

        WaitForEnter(unattended);
        return exitCode;
    }

    private static bool HasFlag(string[] args, string flag)
    {
        foreach (string arg in args)
        {
            if (string.Equals(arg, flag, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static void WaitForEnter(bool unattended)
    {
        if (unattended) return;
        Console.WriteLine();
        Console.Write("Press Enter to close...");
        Console.ReadLine();
    }

    // The address this PC uses to reach the portal (falls back to the first LAN IPv4).
    private static string GetLocalIPv4(string portalUrl)
    {
        try
        {
            Uri portal = new Uri(portalUrl);
            using (Socket probe = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp))
            {
                probe.Connect(portal.Host, portal.Port); // UDP connect sends no packets
                IPEndPoint local = probe.LocalEndPoint as IPEndPoint;
                if (local != null && !IPAddress.IsLoopback(local.Address)) return local.Address.ToString();
            }
        }
        catch (Exception) { }

        try
        {
            foreach (IPAddress address in Dns.GetHostAddresses(Dns.GetHostName()))
            {
                if (address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(address))
                    return address.ToString();
            }
        }
        catch (Exception) { }

        return "127.0.0.1";
    }

    // Environment.OSVersion reports 6.2 on Windows 8.1+ without a manifest, so read the registry.
    private static string GetWindowsVersion()
    {
        try
        {
            using (RegistryKey hklm = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
            using (RegistryKey current = hklm.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion"))
            {
                if (current != null)
                {
                    string product = current.GetValue("ProductName") as string;
                    string build = current.GetValue("CurrentBuild") as string;
                    int buildNumber;
                    // Windows 11 still reports "Windows 10" as its ProductName
                    if (product != null && int.TryParse(build, out buildNumber) && buildNumber >= 22000)
                        product = product.Replace("Windows 10", "Windows 11");
                    if (product != null) return product + " (build " + build + ")";
                }
            }
        }
        catch (Exception) { }
        return Environment.OSVersion.VersionString;
    }

    // 8 hex characters derived from the Windows MachineGuid, so re-running the
    // installer updates the same portal entry instead of creating a duplicate.
    private static string GetStableMachineKey()
    {
        string source = null;
        try
        {
            using (RegistryKey hklm = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
            using (RegistryKey crypto = hklm.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography"))
            {
                if (crypto != null) source = crypto.GetValue("MachineGuid") as string;
            }
        }
        catch (Exception) { }

        if (string.IsNullOrEmpty(source)) source = Environment.MachineName;

        using (SHA256 sha = SHA256.Create())
        {
            byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(source));
            return BitConverter.ToString(hash, 0, 4).Replace("-", "");
        }
    }

    private static void AppendField(StringBuilder json, string name, string value, bool first)
    {
        if (!first) json.Append(",");
        json.Append(JsonString(name)).Append(":").Append(JsonString(value ?? ""));
    }

    private static string JsonString(string value)
    {
        StringBuilder sb = new StringBuilder("\"");
        foreach (char c in value)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                default:
                    if (c < 0x20) sb.AppendFormat("\\u{0:x4}", (int)c);
                    else sb.Append(c);
                    break;
            }
        }
        return sb.Append("\"").ToString();
    }

    private static string PostJson(string url, string json)
    {
        if (url.StartsWith("https:", StringComparison.OrdinalIgnoreCase))
        {
            // TLS 1.2 for https portals; .NET 4.0 without 4.5 doesn't know it, so don't fail on that
            try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; }
            catch (NotSupportedException) { }
        }
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
        request.Method = "POST";
        request.ContentType = "application/json";
        request.Timeout = 15000;
        byte[] body = Encoding.UTF8.GetBytes(json);
        request.ContentLength = body.Length;
        using (Stream stream = request.GetRequestStream())
        {
            stream.Write(body, 0, body.Length);
        }
        using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
        using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
        {
            return reader.ReadToEnd();
        }
    }

    private static string ReadErrorBody(WebException ex)
    {
        if (ex.Response == null) return "";
        try
        {
            using (StreamReader reader = new StreamReader(ex.Response.GetResponseStream(), Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }
        catch (Exception)
        {
            return "";
        }
    }
}
