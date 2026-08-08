//go:build darwin

package main

import "testing"

func TestHostDisplayNameUsesMacOSComputerName(t *testing.T) {
	name, err := readMacOSComputerName(func(command string, args ...string) ([]byte, error) {
		if command != "/usr/sbin/scutil" || len(args) != 2 || args[0] != "--get" || args[1] != "ComputerName" {
			t.Fatalf("computer name command = %q %#v", command, args)
		}
		return []byte("Jasper’s MacBook Air\n"), nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if name != "Jasper’s MacBook Air" {
		t.Fatalf("Host display name = %q", name)
	}
}
